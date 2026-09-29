// Normalización de celdas de la plantilla de importación (docs/14 §3–§4).
// Puro: no toca la base. Los documentos usan las mismas reglas que el panel
// (lib/documento.ts), así que lo importado queda igual que lo cargado a mano.
import { joinDoc, type DocKind } from "@/lib/documento";

/** Clave de comparación: minúsculas, sin acentos, sin puntuación, espacios simples. */
export function normKey(raw: unknown): string {
  return cellText(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

/** Texto limpio para guardar: espacios simples, sin punto final. */
export function cleanText(raw: unknown): string {
  return cellText(raw).replace(/\s+/g, " ").trim().replace(/\.+$/, "").trim();
}

const LOWER_WORDS = new Set(["de", "del", "la", "las", "los", "y"]);

/** Nombres de persona: espacios simples y cada palabra capitalizada ("MARIA  JOSE" → "Maria Jose"). */
export function cleanPersonName(raw: unknown): string {
  return cellText(raw)
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .split(" ")
    .map((w, i) => (i > 0 && LOWER_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

/**
 * Texto de una celda de exceljs, venga como venga: string, número, fecha,
 * texto enriquecido, hipervínculo o fórmula (su resultado).
 */
export function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text?: string }>).map((r) => r.text ?? "").join("");
    if ("result" in o) return cellText(o.result);
    if ("text" in o) return cellText(o.text);
  }
  return String(v);
}

export function isBlank(v: unknown): boolean {
  return cellText(v).trim() === "";
}

/**
 * Cédula o RIF en cualquiera de las formas habituales: `V12345678`, `v-12.345.678`,
 * `J-30123456-7`, `j 301234567`. La letra es obligatoria (una cédula sin V/E es
 * ambigua) → `PREFIJO-dígitos`, validado con joinDoc.
 */
export function parseDoc(raw: unknown, kind: DocKind): { value: string } | { error: string } {
  const text = cellText(raw).trim().toUpperCase();
  const m = text.match(/^([A-Z])[\s.\-]*([\d.\-\s]+)$/);
  if (!m) {
    const label = kind === "cedula" ? "La cédula" : "El RIF";
    return /^\d/.test(text)
      ? { error: `${label} "${text}" no tiene la letra del tipo (${kind === "cedula" ? "V o E" : "J, G, V, E o P"}).` }
      : { error: `${label} "${text}" no tiene un formato válido.` };
  }
  return joinDoc(m[1], m[2], kind);
}

/**
 * Cédula tal como viene en los exports: `V-24.506.123`, `V- 10.137.123`,
 * `V-25,422,123`, `V- 12345678`, `12345678`. Se quitan puntos, comas, espacios y
 * guiones; **sin letra se asume V** (una E de extranjero tiene que venir escrita).
 */
export function parseCedula(raw: unknown): { value: string } | { error: string } {
  const text = cellText(raw).trim().toUpperCase();
  const compact = text.replace(/[\s.,\-_]/g, "");
  const m = compact.match(/^([A-Z]?)(\d+)$/);
  if (!m) return { error: text ? `La cédula "${text}" no tiene un formato válido.` : "Falta la cédula." };
  return joinDoc(m[1] || "V", m[2], "cedula");
}

/** Días de 1899-12-30 (época de Excel) a 1970-01-01. */
const EXCEL_EPOCH_OFFSET = 25569;

/**
 * Fecha pura (`AAAA-MM-DD`). Acepta la fecha de una celda de Excel (exceljs la
 * entrega como Date a medianoche UTC), el número de serie de Excel, y texto
 * `DD/MM/AAAA` o `AAAA-MM-DD`. Nunca pasa por la hora local: una fecha de inicio
 * corrida un día cambia qué marcaciones cuentan para el contrato.
 */
export function parseDate(raw: unknown): { value: string } | { error: string } {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { error: "Fecha inválida." };
    return { value: raw.toISOString().slice(0, 10) };
  }
  if (typeof raw === "number") {
    const ms = Math.round((raw - EXCEL_EPOCH_OFFSET) * 86400000);
    return validYmd(new Date(ms).toISOString().slice(0, 10), String(raw));
  }
  const text = cellText(raw).trim();
  let m = text.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (m) return validYmd(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`, text);
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validYmd(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`, text);
  return { error: `"${text}" no es una fecha (usá DD/MM/AAAA).` };
}

function validYmd(ymd: string, original: string): { value: string } | { error: string } {
  const d = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== ymd) return { error: `"${original}" no es una fecha válida.` };
  const y = d.getUTCFullYear();
  if (y < 1900 || y > 2100) return { error: `"${original}": año fuera de rango.` };
  return { value: ymd };
}

/** `AAAA-MM-DD` → Date a medianoche UTC (lo que Prisma guarda en una columna @db.Date). */
export function ymdToDate(ymd: string): Date {
  return new Date(`${ymd}T00:00:00Z`);
}

/** Date de una columna @db.Date → `AAAA-MM-DD`. */
export function dateToYmd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
