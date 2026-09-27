import { test } from "node:test";
import { strict as assert } from "node:assert";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  buildGalepsoXlsx,
  galepsoFileName,
  usDate,
  usMarkTime,
  usStamp,
  FOOTER_BRAND,
} from "../lib/export/galepso";

// 2026-09-22 16:23:06 en Caracas (UTC-4).
const GENERATED = new Date("2026-09-22T20:23:06Z");

const ROWS = [
  { national_id: "V-25422235", first_name: "Yefri", last_name: "Ramos", io_time: "20260901054000" },
  { national_id: "V-10787913", first_name: "José", last_name: "Zerpa", io_time: "20260901134105" },
  { national_id: "E-84000001", first_name: "Ana", last_name: "Pérez", io_time: "20260915000500" },
];

test("galepso - formatos de fecha y hora (EE. UU., como Adempiere)", () => {
  assert.equal(usDate("2026-09-01"), "9/1/2026");
  assert.equal(usMarkTime("20260901054000"), "9/1/2026 5:40 AM");
  assert.equal(usMarkTime("20260901134105"), "9/1/2026 1:41 PM");
  assert.equal(usMarkTime("20260915000500"), "9/15/2026 12:05 AM");
  assert.equal(usMarkTime("20260915120000"), "9/15/2026 12:00 PM");
  assert.equal(usStamp(GENERATED), "9/22/2026 16:23:06");
});

test("galepso - nombre de archivo: empresa, RIF y hora de Caracas", () => {
  assert.equal(
    galepsoFileName("PANADERIA EL CASTILLO", "J-12345678-9", GENERATED),
    "PANADERIA EL CASTILLO Relación de Asistencia J-12345678-9 20260922_162306.xlsx"
  );
  assert.equal(
    galepsoFileName("A/B: C", null, GENERATED),
    "A B C Relación de Asistencia 20260922_162306.xlsx",
    "sin caracteres inválidos en Windows y sin RIF si falta"
  );
});

test("galepso - estructura del .xlsx (encabezado A1:C4, títulos en 5, texto, pie)", async () => {
  const buf = await buildGalepsoXlsx({
    companyName: "PANADERIA EL CASTILLO",
    from: "2026-09-01",
    to: "2026-09-15",
    generatedAt: GENERATED,
    rows: ROWS,
  });

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  assert.equal(wb.worksheets.length, 1);
  const ws = wb.worksheets[0];
  assert.equal(ws.name, "Sheet1");

  const head = ws.getCell("A1");
  assert.equal(
    head.value,
    "Relación de Asistencia\nPANADERIA EL CASTILLO\nRango de Fecha: 9/1/2026 ~ 9/15/2026\nFecha: 9/22/2026 16:23:06"
  );
  assert.equal(head.font?.name, "Arial");
  assert.equal(head.font?.size, 12);
  assert.equal(head.font?.bold, true);
  assert.equal(head.alignment?.wrapText, true);
  assert.equal(ws.getCell("C4").master.address, "A1", "A1:C4 combinadas");

  assert.deepEqual([1, 2, 3].map((c) => ws.getRow(5).getCell(c).value), ["Cédula", "Nombre", "Hora de Asistencia"]);
  assert.equal(ws.getCell("A5").font?.bold, true);

  const data = [6, 7, 8].map((r) => [1, 2, 3].map((c) => ws.getRow(r).getCell(c).value));
  assert.deepEqual(data, [
    ["25422235", "Yefri Ramos", "9/1/2026 5:40 AM"],
    ["10787913", "José Zerpa", "9/1/2026 1:41 PM"],
    ["84000001", "Ana Pérez", "9/15/2026 12:05 AM"],
  ]);
  for (const row of data) for (const v of row) assert.equal(typeof v, "string", "todas las celdas son texto");

  const foot = ws.getCell("A9");
  assert.equal(foot.value, `${FOOTER_BRAND} (9/22/2026 16:23:06)`);
  assert.equal(foot.font?.italic, true);
  assert.equal(foot.font?.size, 8);
  assert.equal(ws.getCell("C9").master.address, "A9", "pie combinado A:C");
  assert.equal(ws.rowCount, 9);

  // A nivel XML: la cédula va como string (t="s"), no como número.
  const zip = await JSZip.loadAsync(buf);
  const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.match(sheet, /<c r="A6"[^>]*t="s"/);
  assert.match(sheet, /<mergeCell ref="A1:C4"\/>/);
});

test("galepso - sin marcaciones: encabezado, títulos y pie en la fila 6", async () => {
  const buf = await buildGalepsoXlsx({ companyName: "X", from: "2026-09-01", to: "2026-09-01", generatedAt: GENERATED, rows: [] });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  assert.equal(ws.getCell("A5").value, "Cédula");
  assert.match(String(ws.getCell("A6").value), /^Generado por/);
});
