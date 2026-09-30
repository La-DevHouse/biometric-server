// Lectura del "ROSTER DE PERSONAL" de Galepso impreso a PDF (docs/14 §3.1).
// No es una tabla: es un reporte con encabezados en dos renglones, trabajadores
// agrupados por departamento y subtotales. El texto viene en orden de dibujo, no
// de lectura, así que cada valor se ubica por su POSICIÓN en la página: la cédula
// se reconoce por su forma y el resto se asigna a la columna cuyo encabezado le
// queda más cerca en x, comparando solo entre columnas del mismo tipo (una fecha
// solo puede ser nacimiento, ingreso o egreso).
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { normKey } from "./normalize";
import { MAX_ROWS, type ColumnKey, type ReadResult } from "./read";

interface Item {
  x: number;
  y: number;
  text: string;
}

/** Diferencia de altura (en puntos) dentro de la cual dos textos van en el mismo renglón. */
const ROW_TOLERANCE = 3;
const DATE = /^\d{2}\/\d{2}\/\d{4}$/;
/** Sin letra también: el PDF a veces pierde la "V" ("-18871497"). */
const CEDULA = /^[VE]?\s*-?\s*\d[\d.]{5,11}$/i;
const NUMBER = /^[\d.,]+$/;

type TextColumn = "full_name" | "cargo" | "status" | "tipo";
type DateColumn = "birth_date" | "start_date" | "egreso";

const TEXT_HEADERS: Record<string, TextColumn> = { nombre: "full_name", cargo: "cargo", status: "status", personal: "tipo" };
const DATE_HEADERS: Record<string, DateColumn> = { nacimiento: "birth_date", ingreso: "start_date", egreso: "egreso" };

export async function readGalepsoPdf(buf: Buffer | Uint8Array): Promise<ReadResult> {
  const out: ReadResult = { sheetName: null, headerRow: null, rows: [], errors: [], warnings: [] };
  let pages: Item[][];
  try {
    pages = await pdfItems(buf);
  } catch {
    out.errors.push("El archivo no es un PDF válido.");
    return out;
  }
  if (pages.every((p) => p.length === 0)) {
    out.errors.push("El PDF no tiene texto (¿es un escaneo o una foto?). Sacá el reporte de Galepso con Imprimir → Microsoft Print to PDF.");
    return out;
  }

  let reportTotal: number | null = null;
  let headersFound = false;
  let skipped = 0;
  for (const items of pages) {
    const rows = groupRows(items);
    const anchors = findAnchors(items);
    for (const row of rows) {
      const total = generalTotal(row);
      if (total !== null) reportTotal = total;
    }
    if (!anchors) continue;
    headersFound = true;
    for (const row of rows) {
      const ced = row.find((i) => CEDULA.test(i.text));
      if (!ced) continue;
      const cells = rowCells(row, ced, anchors);
      if (cells.status && normKey(cells.status) !== "activo") {
        skipped++;
        continue;
      }
      out.rows.push({ row: out.rows.length + 1, cells: cells.cells });
    }
  }

  if (!headersFound) {
    out.errors.push("No se encontraron los encabezados del reporte (CÉDULA, NOMBRE, CARGO, FECHA INGRESO). ¿Es el Roster de Personal de Galepso?");
    return out;
  }
  if (skipped) out.warnings.push(`${skipped} trabajador(es) del reporte no están ACTIVO: no se importan.`);
  if (out.rows.length === 0) out.errors.push("El reporte no tiene trabajadores.");
  if (out.rows.length > MAX_ROWS) out.errors.push(`Tiene ${out.rows.length} trabajadores; el máximo es ${MAX_ROWS}. Dividilo en varios archivos.`);
  if (reportTotal === null) {
    out.warnings.push("No se encontró el TOTALES GENERALES del reporte: revisá que estén todos los trabajadores.");
  } else if (reportTotal !== out.rows.length + skipped) {
    out.errors.push(
      `El reporte dice ${reportTotal} trabajadores (TOTALES GENERALES) pero se leyeron ${out.rows.length + skipped}. No se importa nada para no dejar a nadie afuera.`
    );
  }
  return out;
}

async function pdfItems(buf: Buffer | Uint8Array): Promise<Item[][]> {
  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  try {
    const pages: Item[][] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items: Item[] = [];
      for (const it of content.items) {
        if (!("str" in it)) continue;
        const text = it.str.replace(/\s+/g, " ").trim();
        if (text) items.push({ x: it.transform[4], y: it.transform[5], text });
      }
      pages.push(items);
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/** Renglones de arriba hacia abajo, cada uno ordenado de izquierda a derecha. */
function groupRows(items: Item[]): Item[][] {
  const rows: Item[][] = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last[0].y - it.y) <= ROW_TOLERANCE) last.push(it);
    else rows.push([it]);
  }
  return rows.map((r) => r.sort((a, b) => a.x - b.x));
}

interface Anchors {
  text: Array<{ x: number; col: TextColumn }>;
  date: Array<{ x: number; col: DateColumn }>;
}

/** Alto de la franja de encabezados alrededor de CÉDULA (los de fecha van en dos renglones). */
const HEADER_BAND = 15;

/**
 * Posición de cada encabezado de la página, solo en la franja de CÉDULA: arriba
 * del reporte hay un "STATUS : ACTIVO" de los filtros que no es la columna.
 * Sin nombre, cargo e ingreso no es el roster.
 */
function findAnchors(items: Item[]): Anchors | null {
  const ced = items.find((it) => normKey(it.text) === "cedula");
  if (!ced) return null;
  const text: Anchors["text"] = [];
  const date: Anchors["date"] = [];
  for (const it of items) {
    if (Math.abs(it.y - ced.y) > HEADER_BAND) continue;
    const k = normKey(it.text);
    if (TEXT_HEADERS[k] && !text.some((a) => a.col === TEXT_HEADERS[k])) text.push({ x: it.x, col: TEXT_HEADERS[k] });
    if (DATE_HEADERS[k] && !date.some((a) => a.col === DATE_HEADERS[k])) date.push({ x: it.x, col: DATE_HEADERS[k] });
  }
  const has = (c: TextColumn | DateColumn) => text.some((a) => a.col === c) || date.some((a) => a.col === c);
  return has("full_name") && has("cargo") && has("start_date") ? { text, date } : null;
}

function nearest<C>(x: number, anchors: Array<{ x: number; col: C }>): C {
  return anchors.reduce((best, a) => (Math.abs(a.x - x) < Math.abs(best.x - x) ? a : best)).col;
}

function rowCells(row: Item[], ced: Item, anchors: Anchors): { cells: Record<ColumnKey, unknown>; status: string | null } {
  const parts: Record<TextColumn, string[]> = { full_name: [], cargo: [], status: [], tipo: [] };
  const dates: Partial<Record<DateColumn, string>> = {};
  for (const it of row) {
    if (it.x <= ced.x) continue; // código y la propia cédula
    if (DATE.test(it.text)) dates[nearest(it.x, anchors.date)] ??= it.text;
    else if (!NUMBER.test(it.text)) parts[nearest(it.x, anchors.text)].push(it.text);
  }
  const join = (c: TextColumn) => (parts[c].length ? parts[c].join(" ") : null);
  return {
    cells: {
      cedula: ced.text,
      full_name: join("full_name"),
      cargo: join("cargo"),
      start_date: dates.start_date ?? null,
      birth_date: dates.birth_date ?? null,
    },
    status: join("status"),
  };
}

/** "TOTALES GENERALES : 13.00" → 13. pdf.js puede darlo en uno o en dos textos. */
function generalTotal(row: Item[]): number | null {
  const m = row.map((it) => it.text).join(" ").match(/TOTALES GENERALES\s*:?\s*([\d.,]+)/i);
  return m ? Math.round(Number(m[1].replace(/,/g, ""))) : null;
}
