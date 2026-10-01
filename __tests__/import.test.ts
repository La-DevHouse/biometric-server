// Importación de trabajadores por empresa desde el export de Galepso (docs/14).
// Los .xlsx se generan acá con la misma forma que el export real (títulos arriba,
// encabezados en la fila 8, columna N°); nunca un archivo real.
import { test, after } from "node:test";
import { strict as assert } from "node:assert";

{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

import ExcelJS from "exceljs";
const db = require("../lib/db") as typeof import("../lib/db");
const service = require("../lib/import/service") as typeof import("../lib/import/service");
const names = require("../lib/import/names") as typeof import("../lib/import/names");
const normalize = require("../lib/import/normalize") as typeof import("../lib/import/normalize");
const { prisma } = db;

const seed = Date.now() % 100000;
let cedSeq = 0;
const CED = () => `V-${String(20000000 + seed * 100 + ++cedSeq)}`;
const TAG = `Imptest${seed}`;
const UP = TAG.toUpperCase(); // en el export todo viene en mayúsculas
const companies: number[] = [];

after(async () => {
  const emps = await prisma.employee.findMany({ where: { last_name: { contains: TAG } }, select: { id: true } });
  await prisma.employment.deleteMany({ where: { OR: [{ company_id: { in: companies } }, { employee_id: { in: emps.map((e) => e.id) } }] } });
  await prisma.employee.deleteMany({ where: { id: { in: emps.map((e) => e.id) } } });
  await prisma.import_run.deleteMany({ where: { company_id: { in: companies } } });
  await prisma.client_company.deleteMany({ where: { id: { in: companies } } });
  await prisma.position.deleteMany({ where: { name: { contains: TAG, mode: "insensitive" } } });
  await prisma.audit_log.deleteMany({ where: { action: { startsWith: "import." } } });
  await prisma.$disconnect();
});

async function company(): Promise<number> {
  const c = await prisma.client_company.create({
    data: { name: `Empresa ${TAG} ${companies.length}`, tax_id: `J-${String(500000000 + seed * 10 + companies.length).slice(0, 9)}`, sites: { create: { name: "Principal" } } },
  });
  companies.push(c.id);
  return c.id;
}

type Row = [string, string, string, Date | string | null];
/** Como el export real: filas vacías, título combinado, encabezados en la fila 8. */
async function galepso(rows: Row[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("RESUMEN DE PAGO");
  ws.getCell("A4").value = "LISTADO DE TRABAJADORES ACTIVOS";
  ws.mergeCells("A4:E5");
  ws.getRow(8).values = ["N°", "NOMBRES Y APELLIDOS", "CEDULA", "CARGO", "FECHA DE INGRESO"];
  rows.forEach(([name, ced, cargo, date], i) => {
    ws.getRow(9 + i).values = [i + 1, name, ced, cargo, date];
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const d = (y: number, m: number, day: number) => new Date(Date.UTC(y, m - 1, day));

/** Un trabajador del Roster de Personal: fechas en DD/MM/AAAA como las imprime Galepso. */
interface RosterRow {
  ced: string;
  name: string;
  cargo: string;
  ingreso: string;
  nacimiento?: string;
  status?: string;
}
/**
 * PDF con la forma del "ROSTER DE PERSONAL" de Galepso impreso a PDF: filtros
 * arriba (con su propio "STATUS : ACTIVO"), encabezados de fecha en dos renglones,
 * departamentos con subtotal y TOTALES GENERALES. Las x son las del reporte real.
 */
function rosterPdf(depts: Array<{ name: string; rows: RosterRow[] }>, opts: { total?: number } = {}): Buffer {
  const texts: Array<[number, number, string]> = [];
  const t = (x: number, y: number, s: string) => texts.push([x, y, s]);
  t(216, 595, "PANADERIA DE PRUEBA");
  t(292, 564, "ROSTER DE PERSONAL");
  t(488, 549, "STATUS :");
  t(532, 549, "ACTIVO");
  t(199, 548, "EMPLEADO INICIAL :");
  t(287, 548, "1");
  for (const [x, s] of [[9, "CÓDIGO"], [47, "CÉDULA"], [121, "NOMBRE"], [255, "CARGO"], [426, "STATUS"], [485, "PERSONAL"], [533, "NACIMIENTO"], [587, "INGRESO"], [635, "EGRESO"], [694, "SUELDO"]] as const) t(x, 493, s);
  for (const [x, s] of [[491, "TIPO DE"], [544, "FECHA"], [591, "FECHA"], [637, "FECHA"]] as const) t(x, 503, s);
  let y = 463;
  let code = 1;
  let count = 0;
  for (const dept of depts) {
    t(11, y, "DEPARTAMENTO :");
    t(80, y, dept.name);
    y -= 10;
    for (const r of dept.rows) {
      t(31, y, String(code++));
      t(44, y, r.ced);
      t(98, y, r.name);
      t(291, y, r.cargo);
      t(428, y, r.status ?? "ACTIVO");
      t(497, y, "FIJO");
      if (r.nacimiento) t(536, y, r.nacimiento);
      t(585, y, r.ingreso);
      t(723, y, "0.00");
      y -= 11;
      count++;
    }
    t(19, y, "TOTAL TRABAJADORES");
    t(265, y, String(dept.rows.length));
    y -= 17;
  }
  t(19, y, "TOTALES GENERALES :");
  t(100, y, `${opts.total ?? count}.00`);

  const esc = (s: string) => s.replace(/[\\()]/g, "\\$&");
  const stream = texts.map(([x, yy, s]) => `BT /F1 7 Tf 1 0 0 1 ${x} ${yy} Tm (${esc(s)}) Tj ET`).join("\n");
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

const applyFile = async (companyId: number, buf: Buffer, overrides = {}) => {
  const view = await service.previewCompanyImport(companyId, buf, "test.xlsx", null);
  assert.equal(view.ok, true, JSON.stringify(view.rejected));
  const res = await service.confirmCompanyImport(view.runId, null, overrides);
  assert.equal(res.status, "applied", JSON.stringify(res));
  return view;
};

test("nombres - separación por cantidad de palabras, partículas y nombres de pila", () => {
  const s = (full: string) => {
    const r = names.splitFullName(full)!;
    return [r.firstName, r.lastName, r.ambiguous];
  };
  assert.deepEqual(s("CARMEN GREGORIA PALENCIA PALENCIA"), ["Carmen Gregoria", "Palencia Palencia", false]);
  assert.deepEqual(s("YEFRI JOSE RAMOS"), ["Yefri Jose", "Ramos", false], "3 palabras, la segunda es nombre de pila");
  assert.deepEqual(s("MARIA PEREZ GOMEZ"), ["Maria", "Perez Gomez", true], "3 palabras sin certeza: 1+2, a revisar");
  assert.deepEqual(s("JUAN LUIS DE GOUVEIA RODRIGUEZ"), ["Juan Luis", "De Gouveia Rodriguez", false], "DE va pegado al apellido");
  assert.deepEqual(s("MARIA DE LOS ANGELES PEREZ"), ["Maria de los Angeles", "Perez", false], "nombre compuesto con partícula");
  assert.deepEqual(s("PEDRO PEREZ"), ["Pedro", "Perez", false]);
  assert.equal(names.splitFullName("MADONNA"), null, "una sola palabra: no se puede");
  const forced = names.splitFullName("ANA MARIA FERNANDEZ ORELLANA", 3)!;
  assert.deepEqual([forced.firstName, forced.lastName], ["Ana Maria Fernandez", "Orellana"], "el corte elegido en la vista previa manda");
});

test("cédula - guiones, puntos, comas, espacios; sin letra = V", () => {
  for (const [raw, want] of [
    ["V-24.506.123", "V-24506123"],
    ["V- 10.137.123", "V-10137123"],
    ["V-25,422,123", "V-25422123"],
    ["V- 12345678", "V-12345678"],
    ["12.345.678", "V-12345678"],
    [12345678, "V-12345678"],
    ["e-81.234.567", "E-81234567"],
  ] as Array<[unknown, string]>) {
    assert.deepEqual(normalize.parseCedula(raw), { value: want }, String(raw));
  }
  assert.ok("error" in normalize.parseCedula("X-123"));
});

test("importar - listado de una empresa: personas, contratos con fecha de ingreso, cargos, y la segunda vez nada", async () => {
  const id = await company();
  const hornero = await prisma.position.create({ data: { name: `Hornero ${TAG}` } });
  const [c1, c2, c3] = [CED(), CED(), CED()];
  const rows: Row[] = [
    [`CARMEN GREGORIA ${TAG} PALENCIA`, c1, `HORNERO ${UP}`, d(2019, 1, 30)],
    [`YEFRI JOSE ${TAG}`, c2, `HORMERO ${UP}`, d(2024, 4, 28)],
    [`MARIA ${TAG} GOMEZ`, c3, `DESPACHADORA ${UP}`, "01/08/2020"],
  ];
  const buf = await galepso(rows);
  const view = await service.previewCompanyImport(id, buf, "test.xlsx", null);
  assert.equal(view.ok, true, JSON.stringify(view.rejected));
  assert.equal(view.counts.newPeople, 3);
  assert.equal(view.counts.newContracts, 3);
  assert.equal(view.counts.ambiguous, 1, `"MARIA X GOMEZ" queda para revisar`);
  const kinds = Object.fromEntries(view.cargos.map((c) => [c.text.split(" ")[0], c.resolution.kind]));
  assert.deepEqual(kinds, { Hornero: "existing", Hormero: "new", Despachadora: "new" });

  // Ajustes de la vista previa: MARIA X | GOMEZ (2 nombres), HORMERO → Hornero.
  const hormeroKey = view.cargos.find((c) => c.text.startsWith("Hormero"))!.key;
  const res = await service.confirmCompanyImport(view.runId, null, { splits: { [c3]: 2 }, cargos: { [hormeroKey]: { kind: "existing", id: hornero.id } } });
  assert.equal(res.status, "applied");

  const maria = await prisma.employee.findUnique({ where: { national_id: c3 } });
  assert.equal(maria?.last_name, "Gomez");
  const yefri = await prisma.employee.findUnique({ where: { national_id: c2 }, include: { employments: true } });
  assert.equal(yefri?.first_name, "Yefri Jose");
  assert.equal(yefri?.employments[0].company_id, id);
  assert.equal(yefri?.employments[0].start_date.toISOString().slice(0, 10), "2024-04-28", "fecha de ingreso = inicio del contrato, sin correrse");
  assert.equal(yefri?.employments[0].position_id, hornero.id, "HORMERO quedó en Hornero");
  assert.equal((await prisma.employee.findUnique({ where: { national_id: c3 }, include: { employments: true } }))?.employments[0].start_date.toISOString().slice(0, 10), "2020-08-01");
  assert.ok(await prisma.position.findFirst({ where: { name: `Despachadora ${TAG.toLowerCase()}` } }), "cargo nuevo creado como puesto");
  assert.equal((await prisma.position_alias.findUnique({ where: { alias_key: hormeroKey } }))?.position_id, hornero.id, "la asignación se recuerda");

  // Segunda vez: todos ya tienen su contrato.
  const again = await service.previewCompanyImport(id, buf, "test.xlsx", null);
  assert.equal(again.counts.newContracts + again.counts.updatedContracts, 0);
  assert.equal(again.counts.sameContracts, 3);

  // Otra empresa con HORMERO: sale solo por el alias.
  const other = await company();
  const v2 = await service.previewCompanyImport(other, await galepso([[`LUIS ${TAG} PEREZ`, CED(), `HORMERO ${UP}`, d(2025, 1, 2)]]), "t.xlsx", null);
  assert.equal(v2.cargos[0].resolution.kind, "alias");
  await prisma.position_alias.deleteMany({ where: { position_id: hornero.id } });
});

test("importar - cargos del mismo archivo: unificar (Hormero = Hornero, Despachadora = Despachador) y corregir el nombre", async () => {
  const id = await company();
  const rows: Row[] = [
    [`ANA MARIA ${TAG} UNO`, CED(), `HORNERO ${UP}X`, d(2024, 1, 1)],
    [`LUIS JOSE ${TAG} DOS`, CED(), `HORMERO ${UP}X`, d(2024, 1, 1)],
    [`PEDRO JOSE ${TAG} TRES`, CED(), `DESPACHADOR ${UP}X`, d(2024, 1, 1)],
    [`ROSA MARIA ${TAG} CUATRO`, CED(), `DESPACHADORA ${UP}X`, d(2024, 1, 1)],
    [`JUAN JOSE ${TAG} CINCO`, CED(), `ENCARGDO ${UP}X`, d(2024, 1, 1)],
  ];
  const view = await service.previewCompanyImport(id, await galepso(rows), "t.xlsx", null);
  assert.ok(view.cargos.every((c) => c.resolution.kind === "new"), "base sin estos puestos: todos serían nuevos");
  const key = (prefix: string) => view.cargos.find((c) => c.text.startsWith(prefix))!.key;
  const res = await service.confirmCompanyImport(view.runId, null, {
    cargos: {
      [key("Hormero")]: { kind: "same", key: key("Hornero") },
      [key("Despachadora")]: { kind: "same", key: key("Despachador ") },
      [key("Encargdo")]: { kind: "new", name: `Encargado ${UP}X` },
    },
  });
  assert.equal(res.status, "applied");
  if (res.status === "applied") assert.equal(res.result.positionsCreated, 3, "Hornero, Despachador y Encargado: nada duplicado");

  const posOf = async (i: number) => {
    const emp = await prisma.employee.findFirst({ where: { last_name: { contains: `${TAG} ${["Uno", "Dos", "Tres", "Cuatro", "Cinco"][i]}` } }, include: { employments: { include: { position: true } } } });
    return emp!.employments[0].position!.name;
  };
  assert.equal(await posOf(1), await posOf(0), "Hormero quedó en el mismo puesto que Hornero");
  assert.equal(await posOf(3), await posOf(2), "Despachadora quedó en el mismo puesto que Despachador");
  assert.match(await posOf(4), /^Encargado /, "nombre corregido");

  // El próximo archivo, de cualquier empresa, ya sabe qué hacer con esos cargos.
  const other = await company();
  const v2 = await service.previewCompanyImport(other, await galepso([[`EVA ${TAG} SEIS`, CED(), `HORMERO ${UP}X`, d(2025, 1, 1)], [`IRIS ${TAG} SIETE`, CED(), `ENCARGDO ${UP}X`, d(2025, 1, 1)]]), "t.xlsx", null);
  assert.deepEqual(v2.cargos.map((c) => c.resolution.kind), ["alias", "alias"]);
  await prisma.position_alias.deleteMany({ where: { alias: { contains: `${UP}X` } } });
});

test("importar - persona que ya existe: no se le cambia el nombre; mismo ingreso con otro cargo cambia el puesto", async () => {
  const id = await company();
  const ced = CED();
  await prisma.employee.create({ data: { national_id: ced, first_name: "Ana Maria", last_name: `Fernandez ${TAG}` } });
  await applyFile(id, await galepso([[`ANA MARIA FERNANDEZ ${TAG}`, ced, `CAJERA ${UP}`, d(2022, 3, 28)]]));
  const v = await service.previewCompanyImport(id, await galepso([[`ANITA FERNANDEZ ${TAG}`, ced, `ENCARGADA ${UP}`, d(2022, 3, 28)]]), "t.xlsx", null);
  const p = v.people[0];
  assert.equal(p.employee, "existing");
  assert.equal(p.firstName, "Ana Maria", "se muestra y se deja el nombre del sistema");
  assert.match(p.fileName ?? "", /ANITA/);
  assert.equal(p.contract, "update");
  assert.equal(p.changes[0].field, "Puesto");
});

test("importar - una fila mala bloquea todo; contrato vigente con otra fecha; ausentes solo se listan", async () => {
  const id = await company();
  const [a, b] = [CED(), CED()];
  await applyFile(id, await galepso([[`PEDRO LUIS ${TAG} UNO`, a, "", d(2021, 5, 1)], [`ROSA ${TAG} DOS`, b, "", d(2021, 5, 1)]]));

  const v = await service.previewCompanyImport(
    id,
    await galepso([
      [`PEDRO LUIS ${TAG} UNO`, a, "", d(2023, 1, 1)], // vigente desde 2021 → rechazada
      [`NUEVO ${TAG} TRES`, CED(), "", null], // sin fecha de ingreso
      [`OTRO ${TAG} CUATRO`, "X-1", "", d(2023, 1, 1)], // cédula inválida
    ]),
    "t.xlsx",
    null
  );
  assert.equal(v.ok, false);
  const msgs = v.rejected.map((r) => `${r.row}:${r.column}:${r.message}`).join("\n");
  assert.match(msgs, /9:FECHA DE INGRESO:Ya tiene un contrato vigente en esta empresa desde 01\/05\/2021/);
  assert.match(msgs, /10:FECHA DE INGRESO:Falta la fecha de ingreso/);
  assert.match(msgs, /11:CEDULA:/);
  assert.deepEqual(v.absent.map((x) => x.cedula), [b], "ROSA no está en el archivo: se lista, no se da de baja");
  await assert.rejects(service.confirmCompanyImport(v.runId, null));
});

test("importar - si algo cambia entre la vista previa y confirmar, vuelve a la vista previa", async () => {
  const id = await company();
  const ced = CED();
  const v = await service.previewCompanyImport(id, await galepso([[`IRIS ${TAG} SEIS`, ced, "", d(2024, 1, 1)]]), "t.xlsx", null);
  await prisma.employee.create({ data: { national_id: ced, first_name: "Iris", last_name: `Otra ${TAG}` } });
  const res = await service.confirmCompanyImport(v.runId, null);
  assert.equal(res.status, "changed");
  if (res.status === "changed") assert.equal(res.view.people[0].employee, "existing");
});

test("importar - una importación sin confirmar se retoma desde el historial y se confirma", async () => {
  const id = await company();
  const ced = CED();
  const first = await service.previewCompanyImport(id, await galepso([[`OLGA MARIA ${TAG} OCHO`, ced, "", d(2024, 2, 1)]]), "t.xlsx", null);
  // Más tarde, desde el historial:
  const again = await service.reopenCompanyImport(first.runId, id);
  assert.equal(again.runId, first.runId, "la misma importación, sin volver a subir el archivo");
  assert.equal(again.counts.newContracts, 1);
  await assert.rejects(service.reopenCompanyImport(first.runId, id + 999999), /no existe en esta empresa/);
  const res = await service.confirmCompanyImport(again.runId, null);
  assert.equal(res.status, "applied");
  await assert.rejects(service.reopenCompanyImport(first.runId, id), /ya se aplicó/);
});

test("importar - el archivo no es un listado de Galepso", async () => {
  const id = await company();
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet("Hoja1").addRow(["Nombre", "Telefono"]);
  const v = await service.previewCompanyImport(id, Buffer.from(await wb.xlsx.writeBuffer()), "t.xlsx", null);
  assert.equal(v.ok, false);
  assert.match(v.rejected[0].message, /No se encontró la fila de encabezados/);
});

test("importar PDF - Roster de Personal: departamentos, cédula sin V, nacimiento cuando está, no ACTIVO afuera", async () => {
  const id = await company();
  const [c1, c2, c3, c4] = [CED(), CED(), CED(), CED()];
  const pdf = rosterPdf([
    {
      name: "1 - OPERATIVO",
      rows: [
        { ced: c1, name: `AURELIO HERNAN ${UP} ALVAREZ`, cargo: `HORNERO ${UP}`, ingreso: "28/10/2020", nacimiento: "25/09/1965" },
        { ced: c2, name: `LUIS MIGUEL ${UP} LINAREZ`, cargo: `HORNERO ${UP}`, ingreso: "05/09/2025" },
      ],
    },
    {
      name: "3 - ATENCIÓN AL PUBLICO",
      rows: [
        // El PDF a veces pierde la "V" de la cédula.
        { ced: c3.slice(1), name: `NORELYS YASAIRA ${UP} NAVAS`, cargo: `DESPACHADORA - ATENCIÓN AL ${UP}`, ingreso: "17/11/2025", nacimiento: "26/08/1986" },
        { ced: c4, name: `PEDRO JOSE ${UP} EGRESADO`, cargo: `CAJERO ${UP}`, ingreso: "01/01/2020", status: "EGRESADO" },
      ],
    },
  ]);
  const view = await service.previewCompanyImport(id, pdf, "ACTIVOS.pdf", null);
  assert.equal(view.ok, true, JSON.stringify(view.rejected));
  assert.deepEqual(view.people.map((p) => p.cedula).sort(), [c1, c2, c3].sort(), "c3 sin V se lee como V-; el EGRESADO no entra");
  assert.match(view.warnings.join(" "), /1 trabajador\(es\) del reporte no están ACTIVO/);
  const byCed = new Map(view.people.map((p) => [p.cedula, p]));
  assert.equal(byCed.get(c1)?.birthDate, "1965-09-25", "25/09/1965 es nacimiento, 28/10/2020 es ingreso: cada una en su columna");
  assert.equal(byCed.get(c1)?.startDate, "2020-10-28");
  assert.equal(byCed.get(c2)?.birthDate, null, "sin nacimiento en el reporte");
  assert.equal(byCed.get(c3)?.startDate, "2025-11-17");
  assert.deepEqual(view.cargos.map((c) => c.text).sort(), [`Despachadora - atención al ${TAG.toLowerCase()}`, `Hornero ${TAG.toLowerCase()}`].sort());

  const res = await service.confirmCompanyImport(view.runId, null);
  assert.equal(res.status, "applied");
  const aurelio = await prisma.employee.findUnique({ where: { national_id: c1 }, include: { employments: true } });
  assert.equal(aurelio?.birth_date?.toISOString().slice(0, 10), "1965-09-25");
  assert.equal(aurelio?.employments[0].start_date.toISOString().slice(0, 10), "2020-10-28");
  assert.equal((await prisma.employee.findUnique({ where: { national_id: c2 } }))?.birth_date, null);
  assert.equal((await prisma.employee.findUnique({ where: { national_id: c3 } }))?.last_name, `${TAG} Navas`);
});

test("importar - fecha de nacimiento de alguien que ya existe: se completa o se corrige, nunca se borra", async () => {
  const id = await company();
  const [sinFecha, otraFecha, igual, noViene] = [CED(), CED(), CED(), CED()];
  await prisma.employee.createMany({
    data: [
      { national_id: sinFecha, first_name: "Ana", last_name: `Uno ${TAG}` },
      { national_id: otraFecha, first_name: "Luis", last_name: `Dos ${TAG}`, birth_date: d(1980, 1, 1) },
      { national_id: igual, first_name: "Rosa", last_name: `Tres ${TAG}`, birth_date: d(1990, 5, 5) },
      { national_id: noViene, first_name: "Iris", last_name: `Cuatro ${TAG}`, birth_date: d(1970, 7, 7) },
    ],
  });
  const pdf = rosterPdf([
    {
      name: "1 - OPERATIVO",
      rows: [
        { ced: sinFecha, name: `ANA ${UP} UNO`, cargo: "", ingreso: "01/02/2024", nacimiento: "10/10/1995" },
        { ced: otraFecha, name: `LUIS ${UP} DOS`, cargo: "", ingreso: "01/02/2024", nacimiento: "02/02/1981" },
        { ced: igual, name: `ROSA ${UP} TRES`, cargo: "", ingreso: "01/02/2024", nacimiento: "05/05/1990" },
        { ced: noViene, name: `IRIS ${UP} CUATRO`, cargo: "", ingreso: "01/02/2024" },
      ],
    },
  ]);
  const view = await service.previewCompanyImport(id, pdf, "t.pdf", null);
  assert.equal(view.ok, true, JSON.stringify(view.rejected));
  assert.equal(view.counts.updatedPeople, 2);
  const changes = Object.fromEntries(view.people.map((p) => [p.cedula, p.personChanges]));
  assert.deepEqual(changes[sinFecha], [{ field: "Fecha de nacimiento", from: null, to: "1995-10-10" }]);
  assert.deepEqual(changes[otraFecha], [{ field: "Fecha de nacimiento", from: "1980-01-01", to: "1981-02-02" }]);
  assert.deepEqual(changes[igual], []);
  assert.deepEqual(changes[noViene], [], "no viene en el reporte: no es un cambio");

  const res = await service.confirmCompanyImport(view.runId, null);
  assert.equal(res.status, "applied");
  if (res.status === "applied") assert.equal(res.result.employeesUpdated, 2);
  const birth = async (ced: string) => (await prisma.employee.findUnique({ where: { national_id: ced } }))?.birth_date?.toISOString().slice(0, 10) ?? null;
  assert.equal(await birth(sinFecha), "1995-10-10");
  assert.equal(await birth(otraFecha), "1981-02-02");
  assert.equal(await birth(noViene), "1970-07-07", "la del sistema queda");
  assert.ok(await prisma.audit_log.findFirst({ where: { action: "import.employee.update", entity_id: String((await prisma.employee.findUnique({ where: { national_id: otraFecha } }))!.id) } }));

  // Solo cambia la fecha de nacimiento (contratos ya estaban): igual hay algo para aplicar.
  await prisma.employee.update({ where: { national_id: igual }, data: { birth_date: null } });
  const again = await service.previewCompanyImport(id, pdf, "t.pdf", null);
  assert.equal(again.counts.newContracts + again.counts.updatedContracts, 0);
  assert.equal(again.counts.updatedPeople, 1);
});

test("importar PDF - departamentos: se crean o se enlazan, van al contrato y el puesto queda en su departamento", async () => {
  const id = await company();
  const existente = await prisma.department.create({ data: { name: `Supervisión ${TAG}` } });
  const otroDepto = await prisma.department.create({ data: { name: `Producción ${TAG}` } });
  const hornero = await prisma.position.create({ data: { name: `Hornero ${TAG}D`, department_id: otroDepto.id } });
  const [a, b, c, e, f] = [CED(), CED(), CED(), CED(), CED()];
  const pdf = rosterPdf([
    {
      name: `1 - OPERATIVO ${UP}`,
      rows: [
        { ced: a, name: `ANA MARIA ${UP} UNO`, cargo: `HORNERO ${UP}D`, ingreso: "01/02/2024" },
        { ced: b, name: `LUIS JOSE ${UP} DOS`, cargo: `CAJERO ${UP}D`, ingreso: "01/02/2024" },
      ],
    },
    { name: `2 - SUPERVISION ${UP}`, rows: [{ ced: c, name: `ROSA MARIA ${UP} TRES`, cargo: `SUPERVISOR ${UP}D`, ingreso: "01/02/2024" }] },
    {
      name: `3 - ATENCION AL PUBLICO ${UP}`,
      rows: [
        { ced: e, name: `PEDRO JOSE ${UP} CUATRO`, cargo: `CAJERO ${UP}D`, ingreso: "01/02/2024" },
        { ced: f, name: `IRIS MARIA ${UP} CINCO`, cargo: `DESPACHADOR ${UP}D`, ingreso: "01/02/2024" },
      ],
    },
  ]);
  const view = await service.previewCompanyImport(id, pdf, "t.pdf", null);
  assert.equal(view.ok, true, JSON.stringify(view.rejected));
  const depts = Object.fromEntries(view.departments.map((d) => [d.text, d.resolution.kind]));
  assert.deepEqual(depts, { [`Operativo ${TAG.toLowerCase()}`]: "new", [`Supervision ${TAG.toLowerCase()}`]: "existing", [`Atencion al publico ${TAG.toLowerCase()}`]: "new" }, "sin el número de Galepso; SUPERVISION = Supervisión");
  assert.deepEqual(view.cargos.find((x) => x.text.startsWith("Cajero"))!.departments!.length, 2, "CAJERO en dos departamentos");
  const deptKey = (prefix: string) => view.departments.find((d) => d.text.startsWith(prefix))!.key;

  // "ATENCION AL PUBLICO" → al que ya existe "Producción"; "OPERATIVO" se crea con otro nombre.
  const res = await service.confirmCompanyImport(view.runId, null, {
    departments: { [deptKey("Atencion")]: { kind: "existing", id: otroDepto.id }, [deptKey("Operativo")]: { kind: "new", name: `Operaciones ${TAG}` } },
  });
  assert.equal(res.status, "applied", JSON.stringify(res));
  if (res.status === "applied") assert.equal(res.result.departmentsCreated, 1);

  const contractOf = async (ced: string) =>
    (await prisma.employee.findUnique({ where: { national_id: ced }, include: { employments: { include: { department: true, position: true } } } }))!.employments[0];
  assert.equal((await contractOf(a)).department?.name, `Operaciones ${TAG}`, "nombre corregido");
  assert.equal((await contractOf(c)).department_id, existente.id, "enlazado por nombre");
  assert.equal((await contractOf(f)).department_id, otroDepto.id, "enlazado a mano");
  assert.equal((await prisma.department_alias.findUnique({ where: { alias_key: deptKey("Atencion") } }))?.department_id, otroDepto.id, "se recuerda");

  const operaciones = (await contractOf(a)).department_id;
  assert.equal((await prisma.position.findUnique({ where: { id: hornero.id } }))?.department_id, operaciones, "Hornero se mueve a su departamento aunque tuviera otro");
  assert.equal((await contractOf(c)).position?.department_id, existente.id, "puesto nuevo en su departamento");
  assert.equal((await contractOf(b)).position?.department_id, null, "Cajero está en dos departamentos: no se toca");

  // Otro archivo: el contrato que ya existe cambia de departamento; el alias ya resuelve "ATENCION AL PUBLICO".
  const v2 = await service.previewCompanyImport(
    id,
    rosterPdf([{ name: `3 - ATENCION AL PUBLICO ${UP}`, rows: [{ ced: c, name: `ROSA MARIA ${UP} TRES`, cargo: `SUPERVISOR ${UP}D`, ingreso: "01/02/2024" }] }]),
    "t.pdf",
    null
  );
  assert.equal(v2.departments[0].resolution.kind, "alias");
  const rosa = v2.people[0];
  assert.equal(rosa.contract, "update");
  assert.deepEqual(rosa.changes, [{ field: "Departamento", from: `Supervisión ${TAG}`, to: `Producción ${TAG}` }]);
  await service.confirmCompanyImport(v2.runId, null);
  assert.equal((await contractOf(c)).department_id, otroDepto.id);

  await prisma.department_alias.deleteMany({ where: { department_id: { in: [existente.id, otroDepto.id, operaciones!] } } });
  await prisma.employment.deleteMany({ where: { company_id: id } });
  await prisma.position.deleteMany({ where: { name: { contains: `${TAG}D`, mode: "insensitive" } } });
  await prisma.department.deleteMany({ where: { id: { in: [existente.id, otroDepto.id, operaciones!] } } });
});

test("importar PDF - total del reporte que no cuadra, PDF sin texto, archivo roto", async () => {
  const id = await company();
  const rows = [{ ced: CED(), name: `EVA ${UP} SIETE`, cargo: "", ingreso: "01/03/2024" }];
  const off = await service.previewCompanyImport(id, rosterPdf([{ name: "1 - OPERATIVO", rows }], { total: 2 }), "t.pdf", null);
  assert.equal(off.ok, false);
  assert.match(off.rejected[0].message, /dice 2 trabajadores .* se leyeron 1/);

  const blank = Buffer.from(
    rosterPdf([{ name: "X", rows: [] }])
      .toString("latin1")
      .replace(/BT [^\n]*ET/g, (m) => " ".repeat(m.length)),
    "latin1"
  );
  const v = await service.previewCompanyImport(id, blank, "t.pdf", null);
  assert.equal(v.ok, false);
  assert.match(v.rejected[0].message, /no tiene texto/);

  const broken = await service.previewCompanyImport(id, Buffer.from("%PDF-1.4\nbasura"), "t.pdf", null);
  assert.equal(broken.ok, false);
  assert.match(broken.rejected[0].message, /no es un PDF válido|no tiene texto/);
});

test("importar - 5 000 trabajadores: vista previa + aplicar en tiempo razonable", async () => {
  const id = await company();
  const rows: Row[] = [];
  for (let i = 0; i < 5000; i++) rows.push([`NOMBRE${i} JOSE ${TAG} MASIVO`, `V-${40000000 + seed * 10 + i * 1000}`, `OPERARIO ${UP}`, d(2026, 9, 1)]);
  const buf = await galepso(rows);
  const t0 = Date.now();
  const v = await service.previewCompanyImport(id, buf, "t.xlsx", null);
  const tPreview = Date.now() - t0;
  assert.equal(v.ok, true, JSON.stringify(v.rejected.slice(0, 3)));
  const t1 = Date.now();
  const res = await service.confirmCompanyImport(v.runId, null);
  const tApply = Date.now() - t1;
  assert.equal(res.status, "applied");
  console.log(`[5000] vista previa ${tPreview} ms · aplicar ${tApply} ms`);
  assert.ok(tPreview + tApply < 60_000);
  assert.equal(await prisma.employment.count({ where: { company_id: id } }), 5000);
});
