import type { CedulaExtractedFields, RifPhotoExtractedFields, VisionProvider } from "./types";
import { VisionError } from "./types";

// Gemini Flash, tier gratis (docs/09-reunion-3.md §3.10 — decisión 2026-09-21).
// Sin SDK: la API REST es estable y chica, y así no metemos una dependencia
// pesada solo para dos llamadas. GEMINI_MODEL es configurable por si el
// nombre de modelo cambia (Google los rota con cierta frecuencia).
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

async function callGemini<T>(params: {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  schema: object;
}): Promise<T> {
  if (!API_KEY) {
    throw new VisionError(
      "GEMINI_API_KEY no está configurada — falta la variable de entorno para usar el escaneo por foto."
    );
  }

  const res = await fetch(`${ENDPOINT(MODEL)}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: params.prompt },
            { inline_data: { mime_type: params.mimeType, data: params.imageBase64 } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: params.schema,
        temperature: 0,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new VisionError(`Gemini respondió ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new VisionError("Gemini no devolvió contenido interpretable (¿bloqueado por safety filters?).");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new VisionError(`La respuesta de Gemini no es JSON válido: ${text.slice(0, 300)}`);
  }
}

const CEDULA_PROMPT = `Esta es una foto de una Cédula de Identidad venezolana (República Bolivariana
de Venezuela). El formato tiene, en este orden aproximado: un encabezado
"CEDULA DE IDENTIDAD", luego el prefijo (V o E) y el número (con puntos, ej.
"V 26.750.043"), luego "APELLIDOS" y "NOMBRES" como dos campos separados,
luego una fecha "F. NACIMIENTO" (día/mes/año) junto al estado civil, y más
abajo fechas de expedición/vencimiento, huella y foto.

Extraé exactamente estos datos:
- prefix: "V" o "E" (el prefijo de la cédula, no de otra fecha o código).
- number: el número de cédula, SOLO dígitos, sin puntos ni espacios.
- firstName: el/los nombre(s) (campo "NOMBRES").
- lastName: el/los apellido(s) (campo "APELLIDOS").
- birthDate: la fecha "F. NACIMIENTO" en formato ISO YYYY-MM-DD. Si no se
  puede leer con certeza, devolvé null.

Si algún dato no es legible con certeza, no lo inventes — para birthDate usá
null; para el resto, hacé tu mejor lectura pero nunca inventes dígitos.`;

const CEDULA_SCHEMA = {
  type: "OBJECT",
  properties: {
    prefix: { type: "STRING", enum: ["V", "E"] },
    number: { type: "STRING" },
    firstName: { type: "STRING" },
    lastName: { type: "STRING" },
    birthDate: { type: "STRING", nullable: true },
  },
  required: ["prefix", "number", "firstName", "lastName"],
};

const RIF_PROMPT = `Este es el comprobante de RIF (Registro Único de Información Fiscal)
emitido por el SENIAT de Venezuela — puede ser una foto o un PDF (incluido uno
escaneado, sin texto seleccionable). Tiene un encabezado "REGISTRO ÚNICO DE
INFORMACIÓN FISCAL (RIF)", el prefijo+número del RIF (ej. "V267500432" o
"J111222334", a veces bajo la etiqueta "RIF:"), el nombre o razón social, y un
campo "DOMICILIO FISCAL" (con o sin dos puntos) con la dirección.

Extraé exactamente estos datos:
- taxIdPrefix: una letra de V, E, J, G, P.
- taxIdNumber: el número del RIF, solo dígitos.
- businessName: el nombre completo o razón social que aparece junto al RIF.
- address: el domicilio fiscal completo. Si no es legible, devolvé null.

No inventes dígitos ni texto que no puedas leer con certeza.`;

const RIF_SCHEMA = {
  type: "OBJECT",
  properties: {
    taxIdPrefix: { type: "STRING", enum: ["V", "E", "J", "G", "P"] },
    taxIdNumber: { type: "STRING" },
    businessName: { type: "STRING" },
    address: { type: "STRING", nullable: true },
  },
  required: ["taxIdPrefix", "taxIdNumber", "businessName"],
};

export const geminiVisionProvider: VisionProvider = {
  async extractCedula(image, mimeType) {
    const raw = await callGemini<{
      prefix: string;
      number: string;
      firstName: string;
      lastName: string;
      birthDate: string | null;
    }>({
      imageBase64: image.toString("base64"),
      mimeType,
      prompt: CEDULA_PROMPT,
      schema: CEDULA_SCHEMA,
    });
    if (raw.prefix !== "V" && raw.prefix !== "E") {
      throw new VisionError(`Prefijo de cédula no reconocido: "${raw.prefix}".`);
    }
    const fields: CedulaExtractedFields = {
      prefix: raw.prefix,
      number: raw.number.replace(/\D/g, ""),
      firstName: raw.firstName.trim(),
      lastName: raw.lastName.trim(),
      birthDate: raw.birthDate && /^\d{4}-\d{2}-\d{2}$/.test(raw.birthDate) ? raw.birthDate : null,
    };
    if (!fields.number) throw new VisionError("No se pudo leer el número de cédula.");
    return fields;
  },

  async extractRif(image, mimeType) {
    const raw = await callGemini<{
      taxIdPrefix: string;
      taxIdNumber: string;
      businessName: string;
      address: string | null;
    }>({
      imageBase64: image.toString("base64"),
      mimeType,
      prompt: RIF_PROMPT,
      schema: RIF_SCHEMA,
    });
    const prefix = raw.taxIdPrefix.toUpperCase();
    if (!["V", "E", "J", "G", "P"].includes(prefix)) {
      throw new VisionError(`Prefijo de RIF no reconocido: "${prefix}".`);
    }
    const fields: RifPhotoExtractedFields = {
      taxIdPrefix: prefix,
      taxIdNumber: raw.taxIdNumber.replace(/\D/g, ""),
      businessName: raw.businessName.trim(),
      address: raw.address?.trim() || null,
    };
    if (!fields.taxIdNumber) throw new VisionError("No se pudo leer el número de RIF.");
    return fields;
  },
};
