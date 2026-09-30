// Lectura del export de Galepso "Listado de trabajadores activos" (docs/14 §3):
// una hoja con títulos arriba, una fila de encabezados en algún lugar de las
// primeras filas y los trabajadores debajo. La fila de encabezados se busca sola
// (la que tiene CEDULA); las columnas se reconocen por nombre, y las que no se
// usan (N°) se ignoran.
import ExcelJS from "exceljs";
import { cellText, isBlank, normKey } from "./normalize";
import { readGalepsoPdf } from "./readPdf";

export const MAX_ROWS = 5000;
/** Hasta qué fila se busca la de encabezados. */
const HEADER_SEARCH_ROWS = 30;

export type ColumnKey = "full_name" | "cedula" | "cargo" | "start_date" | "birth_date";

export const COLUMNS: Array<{ key: ColumnKey; header: string; aliases: string[]; required: boolean }> = [
  { key: "full_name", header: "NOMBRES Y APELLIDOS", aliases: ["nombres y apellidos", "nombre y apellido", "apellidos y nombres", "trabajador"], required: true },
  { key: "cedula", header: "CEDULA", aliases: ["cedula", "ci", "c i", "cedula de identidad"], required: true },
  { key: "cargo", header: "CARGO", aliases: ["cargo"], required: false },
  { key: "start_date", header: "FECHA DE INGRESO", aliases: ["fecha de ingreso", "ingreso", "fecha ingreso"], required: true },
  { key: "birth_date", header: "FECHA DE NACIMIENTO", aliases: ["fecha de nacimiento", "fecha nacimiento", "nacimiento"], required: false },
];

export interface RawRow {
  /** Número de fila en Excel. */
  row: number;
  cells: Record<ColumnKey, unknown>;
}

export interface ReadResult {
  sheetName: string | null;
  headerRow: number | null;
  rows: RawRow[];
  /** Problemas que impiden importar (no hay encabezados, faltan columnas, demasiadas filas…). */
  errors: string[];
  warnings: string[];
}

const BY_ALIAS = new Map<string, ColumnKey>(COLUMNS.flatMap((c) => c.aliases.map((a) => [normKey(a), c.key] as [string, ColumnKey])));

/** El Roster de Personal impreso a PDF, o una planilla .xlsx con encabezados. */
export async function readGalepso(buf: Buffer | Uint8Array): Promise<ReadResult> {
  if (Buffer.from(buf.subarray(0, 5)).toString("latin1") === "%PDF-") return readGalepsoPdf(buf);
  return readGalepsoXlsx(buf);
}

async function readGalepsoXlsx(buf: Buffer | Uint8Array): Promise<ReadResult> {
  const out: ReadResult = { sheetName: null, headerRow: null, rows: [], errors: [], warnings: [] };
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(buf) as unknown as ArrayBuffer);
  } catch {
    out.errors.push("El archivo no es un Excel (.xlsx) válido.");
    return out;
  }

  // La primera hoja que tenga una fila de encabezados con CEDULA.
  for (const ws of wb.worksheets) {
    for (let r = 1; r <= Math.min(ws.rowCount, HEADER_SEARCH_ROWS); r++) {
      const cols = new Map<ColumnKey, number>();
      ws.getRow(r).eachCell({ includeEmpty: false }, (cell, col) => {
        const k = BY_ALIAS.get(normKey(cell.value));
        if (k && !cols.has(k)) cols.set(k, col);
      });
      if (!cols.has("cedula")) continue;
      out.sheetName = ws.name;
      out.headerRow = r;
      const missing = COLUMNS.filter((c) => c.required && !cols.has(c.key));
      if (missing.length) {
        out.errors.push(`Faltan columnas: ${missing.map((c) => c.header).join(", ")} (en la fila ${r} de la hoja "${ws.name}").`);
        return out;
      }
      readRows(ws, r, cols, out);
      if (wb.worksheets.length > 1) out.warnings.push(`Se leyó la hoja "${ws.name}"; las demás hojas del archivo se ignoraron.`);
      return out;
    }
  }
  out.errors.push("No se encontró la fila de encabezados (NOMBRES Y APELLIDOS, CEDULA, CARGO, FECHA DE INGRESO). ¿Es el listado de trabajadores de Galepso?");
  return out;
}

function readRows(ws: ExcelJS.Worksheet, headerRow: number, cols: Map<ColumnKey, number>, out: ReadResult): void {
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells = {} as Record<ColumnKey, unknown>;
    for (const c of COLUMNS) cells[c.key] = cols.has(c.key) ? row.getCell(cols.get(c.key)!).value : null;
    // Una fila sin nombre ni cédula es relleno (o un pie de página sin datos).
    if (isBlank(cells.full_name) && isBlank(cells.cedula)) continue;
    // Pie de totales ("TOTAL", "Total trabajadores: 13") sin cédula: se ignora.
    if (isBlank(cells.cedula) && /^total/i.test(cellText(cells.full_name).trim())) continue;
    out.rows.push({ row: r, cells });
  }
  if (out.rows.length === 0) out.errors.push("El listado no tiene trabajadores debajo de los encabezados.");
  if (out.rows.length > MAX_ROWS) out.errors.push(`Tiene ${out.rows.length} trabajadores; el máximo es ${MAX_ROWS}. Dividilo en varios archivos.`);
}
