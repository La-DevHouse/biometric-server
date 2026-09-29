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
  assert.deepEqual(kinds, { Hornero: "position", Hormero: "new", Despachadora: "new" });

  // Ajustes de la vista previa: MARIA X | GOMEZ (2 nombres), HORMERO → Hornero.
  const hormeroKey = view.cargos.find((c) => c.text.startsWith("Hormero"))!.key;
  const res = await service.confirmCompanyImport(view.runId, null, { splits: { [c3]: 2 }, cargos: { [hormeroKey]: { kind: "position", id: hornero.id } } });
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
