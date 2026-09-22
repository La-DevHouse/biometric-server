// Parser determinístico del comprobante de RIF que emite el SENIAT en PDF —
// docs/09-reunion-3.md §3.10 / §7.1 ítem 16. Es un layout de gobierno, fijo,
// con texto real (no una imagen escaneada): no hace falta OCR ni IA para esto,
// alcanza con reconocer las etiquetas del formulario.
//
// Muestra real verificada (RIF de una persona natural, 2026-09):
//   V267500432 JESUS ALEJANDRO PARIS TROCOLI
//   DOMICILIO FISCAL AV INTERCOMUNAL CASA CALLE 3 NRO 45 URB VILLA ESMERALDA...
//   (Este contribuyente no posee firmas personales)
//   FECHA DE INSCRIPCIÓN: 28/10/2016
// El mismo layout aplica a RIF de empresa (prefijo J/G en vez de V/E).

export interface RifExtractedFields {
  taxIdPrefix: string; // V | E | J | G | P
  taxIdNumber: string; // solo dígitos
  businessName: string; // razón social / nombre completo
  address: string | null; // domicilio fiscal
}

const RIF_PREFIXES = new Set(["V", "E", "J", "G", "P"]);

// Prefijo+número, luego la razón social hasta "DOMICILIO FISCAL", luego el
// domicilio hasta "FECHA DE INSCRIPCIÓN" — saltando el paréntesis opcional
// "(Este contribuyente no posee firmas personales)" que aparece en algunos
// comprobantes de persona natural.
const RIF_PATTERN =
  /\b([VEJGP])[\s.-]?(\d{8,10})\b\s+(.+?)\s+DOMICILIO FISCAL\s+(.+?)\s*(?:\(Este contribuyente[^)]*\)\s*)?FECHA DE INSCRIPCI[OÓ]N/i;

export function parseRifText(rawText: string): { fields: RifExtractedFields } | { error: string } {
  const norm = rawText.replace(/\s+/g, " ").trim();
  if (!norm) return { error: "El PDF no tiene texto legible (¿es una imagen escaneada?)." };

  const m = norm.match(RIF_PATTERN);
  if (!m) {
    return {
      error:
        "No se reconoció el formato del RIF. Verificá que sea el comprobante digital del SENIAT en PDF (no una foto o escaneo).",
    };
  }

  const [, prefixRaw, number, businessNameRaw, addressRaw] = m;
  const prefix = prefixRaw.toUpperCase();
  if (!RIF_PREFIXES.has(prefix)) {
    return { error: `Prefijo de RIF no reconocido: "${prefix}".` };
  }

  return {
    fields: {
      taxIdPrefix: prefix,
      taxIdNumber: number,
      businessName: businessNameRaw.trim(),
      address: addressRaw.trim() || null,
    },
  };
}
