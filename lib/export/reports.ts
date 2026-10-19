import ExcelJS from "exceljs";
import { cedulaDigits } from "@/lib/fingerprints";
import { INCIDENT_LABEL, type IncidentRow, type SummaryRow } from "@/lib/attendance/reports";
import { FOOTER_BRAND, usStamp } from "./galepso";

/**
 * Reportes del período en .xlsx (Hito 5, docs/17): consolidado por contrato e
 * incidencias. A diferencia del export a Galepso (formato fijo de Adempiere), estos
 * son para leer y para cargar a mano: encabezado, una fila de títulos con filtro, y
 * números como números (horas con decimales, minutos enteros) para poder sumar.
 */

const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const hours = (min: number) => Math.round((min / 60) * 100) / 100;

function header(ws: ExcelJS.Worksheet, title: string, companyName: string, from: string, to: string, generatedAt: Date, cols: number) {
  const lines = [title, companyName, `Período: ${dmy(from)} al ${dmy(to)}`, `Generado: ${usStamp(generatedAt)}`];
  lines.forEach((text, i) => {
    ws.mergeCells(i + 1, 1, i + 1, cols);
    const c = ws.getCell(i + 1, 1);
    c.value = text;
    c.font = { name: "Arial", size: i === 0 ? 14 : 10, bold: i < 2 };
  });
}

function titles(ws: ExcelJS.Worksheet, row: number, names: string[], widths: number[]) {
  const r = ws.getRow(row);
  names.forEach((n, i) => {
    const c = r.getCell(i + 1);
    c.value = n;
    c.font = { name: "Arial", size: 10, bold: true };
    c.alignment = { wrapText: true, vertical: "bottom" };
    c.border = { bottom: { style: "thin" } };
    ws.getColumn(i + 1).width = widths[i];
  });
  ws.autoFilter = { from: { row, column: 1 }, to: { row, column: names.length } };
  ws.views = [{ state: "frozen", ySplit: row }];
}

function footer(ws: ExcelJS.Worksheet, row: number, cols: number, generatedAt: Date, note?: string) {
  const text = [note, `${FOOTER_BRAND} (${usStamp(generatedAt)})`].filter(Boolean).join("\n");
  ws.mergeCells(row, 1, row, cols);
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { name: "Arial", size: 8, italic: true };
  c.alignment = { wrapText: true };
  ws.getRow(row).height = note ? 36 : 15;
}

export async function buildSummaryXlsx(opts: {
  companyName: string;
  from: string;
  to: string;
  generatedAt: Date;
  rows: SummaryRow[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Consolidado");
  const cols: [string, number, (r: SummaryRow) => string | number][] = [
    ["Cédula", 12, (r) => cedulaDigits(r.nationalId)],
    ["Nombre", 30, (r) => r.name],
    ["Ref. nómina", 12, (r) => r.payrollRef ?? ""],
    ["Horario", 20, (r) => r.scheduleName ?? "Sin horario"],
    ["Días laborables", 10, (r) => r.workdays],
    ["Días trabajados", 10, (r) => r.daysWorked],
    ["Horas trabajadas", 10, (r) => hours(r.workedMinutes)],
    ["Horas extra (referencia)", 11, (r) => hours(r.overtimeMinutes)],
    ["Tardanzas", 10, (r) => r.lates],
    ["Minutos de tardanza", 10, (r) => r.lateMinutes],
    ["Salidas anticipadas", 10, (r) => r.earlyLeaves],
    ["Minutos de salida anticipada", 11, (r) => r.earlyLeaveMinutes],
    ["Ausencias", 10, (r) => r.absences],
    ["Días incompletos", 10, (r) => r.incomplete],
    ["Días libres trabajados", 10, (r) => r.restDaysWorked],
    ["Correcciones manuales", 11, (r) => r.corrections],
  ];
  header(ws, "Consolidado de asistencia", opts.companyName, opts.from, opts.to, opts.generatedAt, cols.length);
  titles(ws, 6, cols.map((c) => c[0]), cols.map((c) => c[1]));
  let row = 7;
  for (const r of opts.rows) {
    const x = ws.getRow(row++);
    cols.forEach(([, , get], i) => {
      const c = x.getCell(i + 1);
      c.value = get(r);
      c.font = { name: "Arial", size: 10 };
    });
  }
  footer(
    ws,
    row + 1,
    cols.length,
    opts.generatedAt,
    "Horas extra solo de referencia, sin recargos legales. Días incompletos: una sola marcación, sin horas. Una tardanza que además salió antes cuenta en las dos columnas."
  );
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function buildIncidentsXlsx(opts: {
  companyName: string;
  from: string;
  to: string;
  generatedAt: Date;
  rows: IncidentRow[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Incidencias");
  const cols: [string, number, (r: IncidentRow) => string | number][] = [
    ["Fecha", 11, (r) => dmy(r.date)],
    ["Cédula", 12, (r) => cedulaDigits(r.nationalId)],
    ["Nombre", 30, (r) => r.name],
    ["Incidencia", 24, (r) => INCIDENT_LABEL[r.kind]],
    ["Minutos", 9, (r) => r.minutes ?? ""],
    ["Hora", 8, (r) => r.time ?? ""],
    ["Motivo", 36, (r) => r.reason ?? ""],
    ["Corregido por", 18, (r) => r.actor ?? ""],
    ["Corregido el", 18, (r) => (r.at ? usStamp(r.at) : "")],
  ];
  header(ws, "Incidencias de asistencia", opts.companyName, opts.from, opts.to, opts.generatedAt, cols.length);
  titles(ws, 6, cols.map((c) => c[0]), cols.map((c) => c[1]));
  let row = 7;
  for (const r of opts.rows) {
    const x = ws.getRow(row++);
    cols.forEach(([, , get], i) => {
      const c = x.getCell(i + 1);
      c.value = get(r);
      c.font = { name: "Arial", size: 10 };
      if (i === 6) c.alignment = { wrapText: true };
    });
  }
  footer(ws, row + 1, cols.length, opts.generatedAt);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** `<EMPRESA> <Consolidado|Incidencias> <desde>_<hasta>.xlsx` */
export function reportFileName(companyName: string, kind: "Consolidado" | "Incidencias", from: string, to: string): string {
  const safe = companyName.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  return `${safe} ${kind} ${from.replace(/-/g, "")}_${to.replace(/-/g, "")}.xlsx`;
}
