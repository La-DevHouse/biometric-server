import ExcelJS from "exceljs";
import { DEFAULT_TZ, formatDeviceTime } from "@/lib/time";
import { cedulaDigits } from "@/lib/fingerprints";

/**
 * Export de asistencia para Galepso (docs/11 R1–R8, formato en §3): réplica del
 * `.xlsx` "Relación de Asistencia" que hoy baja Adempiere y ALCO carga en
 * Galepso. Una hoja; A1:C4 combinadas con el encabezado multilínea; títulos en
 * la fila 5; una fila por marcación cruda desde la 6, TODO como texto; pie
 * combinado A:C en cursiva. Las filas las da `companyAttendance` (por contrato),
 * la misma consulta que se ve en Empresa → Asistencia.
 */

export const FOOTER_BRAND = "Generado por Control de Asistencia Grupo ALCO";

export interface GalepsoRow {
  national_id: string;
  first_name: string;
  last_name: string;
  /** "YYYYMMDDhhmmss", hora local de la sede. */
  io_time: string;
}

/** "YYYY-MM-DD" → "M/D/YYYY" (formato EE. UU., sin ceros a la izquierda, como Adempiere). */
export function usDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** io_time "YYYYMMDDhhmmss" → "M/D/YYYY h:mm AM/PM" (sin segundos). */
export function usMarkTime(ioTime: string): string {
  const y = Number(ioTime.slice(0, 4));
  const mo = Number(ioTime.slice(4, 6));
  const d = Number(ioTime.slice(6, 8));
  const h = Number(ioTime.slice(8, 10));
  const mi = ioTime.slice(10, 12);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${mo}/${d}/${y} ${h12}:${mi} ${h < 12 ? "AM" : "PM"}`;
}

/** Instante → "M/D/YYYY HH:MM:SS" en hora de Caracas (el "Fecha:" y el pie). */
export function usStamp(instant: Date, tz: string = DEFAULT_TZ): string {
  const w = formatDeviceTime(instant, tz); // YYYYMMDDhhmmss en tz
  return `${Number(w.slice(4, 6))}/${Number(w.slice(6, 8))}/${w.slice(0, 4)} ${w.slice(8, 10)}:${w.slice(10, 12)}:${w.slice(12, 14)}`;
}

/** `<EMPRESA> Relación de Asistencia <RIF> <YYYYMMDD>_<HHMMSS>.xlsx` (R6). */
export function galepsoFileName(companyName: string, taxId: string | null, instant: Date, tz: string = DEFAULT_TZ): string {
  const w = formatDeviceTime(instant, tz);
  // Sin caracteres que rompan un nombre de archivo en Windows.
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  const parts = [safe(companyName), "Relación de Asistencia", taxId ? safe(taxId) : null, `${w.slice(0, 8)}_${w.slice(8, 14)}`];
  return `${parts.filter(Boolean).join(" ")}.xlsx`;
}

export async function buildGalepsoXlsx(opts: {
  companyName: string;
  /** "YYYY-MM-DD" */
  from: string;
  /** "YYYY-MM-DD" */
  to: string;
  generatedAt: Date;
  /** En orden cronológico. */
  rows: GalepsoRow[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  const arial10 = { name: "Arial", size: 10 };
  const stamp = usStamp(opts.generatedAt);

  ws.mergeCells("A1:C4");
  const head = ws.getCell("A1");
  head.value = [
    "Relación de Asistencia",
    opts.companyName,
    `Rango de Fecha: ${usDate(opts.from)} ~ ${usDate(opts.to)}`,
    `Fecha: ${stamp}`,
  ].join("\n");
  head.font = { name: "Arial", size: 12, bold: true };
  head.alignment = { wrapText: true };

  const titles = ws.getRow(5);
  ["Cédula", "Nombre", "Hora de Asistencia"].forEach((t, i) => {
    const c = titles.getCell(i + 1);
    c.value = t;
    c.font = { name: "Arial", bold: true };
    c.alignment = { wrapText: true };
  });

  let r = 6;
  for (const row of opts.rows) {
    const x = ws.getRow(r++);
    // Todo texto (strings), como el original: Galepso cruza por cédula como texto.
    const values = [cedulaDigits(row.national_id), `${row.first_name} ${row.last_name}`.trim(), usMarkTime(row.io_time)];
    values.forEach((v, i) => {
      const c = x.getCell(i + 1);
      c.value = v;
      c.font = arial10;
    });
  }

  ws.mergeCells(`A${r}:C${r}`);
  const foot = ws.getCell(`A${r}`);
  foot.value = `${FOOTER_BRAND} (${stamp})`;
  foot.font = { name: "Arial", size: 8, italic: true };
  foot.alignment = { wrapText: true };

  return Buffer.from(await wb.xlsx.writeBuffer());
}
