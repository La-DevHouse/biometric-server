import { test, after } from "node:test";
import { strict as assert } from "node:assert";

// Mismo arreglo que scope.test.ts: apuntar a la base de tests ANTES del require().
{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const ca = require("../lib/companyAttendance") as typeof import("../lib/companyAttendance");
const { prisma } = db;

const P = `CATT_${Date.now()}_`;
// Cédulas únicas por corrida para no chocar con otros datos de la base de tests.
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
const ced = (n: number) => `8${n}${SEED}`;
const created = { groups: [] as number[], companies: [] as number[], employees: [] as number[], devices: [] as string[] };

async function group(shared: boolean) {
  const g = await prisma.company_group.create({ data: { name: P + "G", shared_employees: shared } });
  created.groups.push(g.id);
  return g.id;
}

async function company(name: string, groupId: number | null = null) {
  const c = await prisma.client_company.create({
    data: { name: P + name, tax_id: "J-00000000-0", group_id: groupId, sites: { create: { name: name + " Principal" } } },
    include: { sites: true },
  });
  created.companies.push(c.id);
  return { id: c.id, siteId: c.sites[0].id };
}

async function device(name: string, siteId: number | null) {
  const id = P + name;
  await prisma.devices.create({ data: { dev_id: id, site_id: siteId } });
  created.devices.push(id);
  return id;
}

async function employee(cedula: string) {
  const e = await prisma.employee.create({ data: { national_id: `V-${cedula}`, first_name: "Test", last_name: P } });
  created.employees.push(e.id);
  return e.id;
}

async function contract(employeeId: number, companyId: number, start: string, end: string | null = null) {
  await prisma.employment.create({
    data: {
      employee_id: employeeId,
      company_id: companyId,
      start_date: new Date(`${start}T00:00:00Z`),
      end_date: end ? new Date(`${end}T00:00:00Z`) : null,
      status: end ? "inactive" : "active",
    },
  });
}

async function mark(devId: string, userId: string, ioTime: string) {
  await db.runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time) VALUES (?, ?, ?)`, [devId, userId, ioTime]);
}

after(async () => {
  await prisma.attendance_logs.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.company_group.deleteMany({ where: { id: { in: created.groups } } });
  await prisma.$disconnect();
  await db.closeDb();
});

test("companyAttendance: por contrato, dentro de su período, en todo el alcance del grupo", async () => {
  const g = await group(true);
  const A = await company("A", g);
  const B = await company("B", g);
  const devA = await device("devA", A.siteId);
  const devB = await device("devB", B.siteId);

  const ana = ced(1); // contrato con A desde el 10/09, sin fin
  const beto = ced(2); // contrato con A del 01/09 al 15/09 (baja)
  const caro = ced(3); // contrato solo con B
  await contract(await employee(ana), A.id, "2026-09-10");
  await contract(await employee(beto), A.id, "2026-09-01", "2026-09-15");
  await contract(await employee(caro), B.id, "2026-09-01");

  await mark(devA, ana, "20260909080000"); // antes del inicio → fuera
  await mark(devA, ana, "20260910080000"); // primer día → dentro
  await mark(devB, ana, "20260911080000"); // en la otra empresa del grupo → dentro (R3)
  await mark(devA, beto, "20260915170000"); // último día → dentro
  await mark(devA, beto, "20260916080000"); // después de la baja → fuera
  await mark(devA, caro, "20260911090000"); // sin contrato con A → fuera de A
  await mark(devA, "999", "20260911100000"); // ID sin empleado → nunca

  const rowsA = await ca.companyAttendance(A.id, { order: "asc" });
  assert.deepEqual(
    rowsA.map((r) => `${r.user_id}@${r.io_time}`),
    [`${ana}@20260910080000`, `${ana}@20260911080000`, `${beto}@20260915170000`]
  );
  assert.equal(rowsA[1].site_name, "B Principal", "la sede es donde marcó");

  const rowsB = await ca.companyAttendance(B.id, { order: "asc" });
  assert.deepEqual(rowsB.map((r) => r.user_id), [caro], "B solo ve a quien tiene contrato con B");

  // Filtros: sede y rango.
  const onlyB = await ca.companyAttendance(A.id, { siteId: B.siteId });
  assert.deepEqual(onlyB.map((r) => r.io_time), ["20260911080000"]);
  const range = await ca.companyAttendance(A.id, { from: "2026-09-11", to: "2026-09-15", order: "asc" });
  assert.deepEqual(range.map((r) => r.io_time), ["20260911080000", "20260915170000"]);

  // Orden por defecto: más reciente primero; y el límite.
  const desc = await ca.companyAttendance(A.id, { limit: 1 });
  assert.equal(desc[0].io_time, "20260915170000");

  // Sedes para el filtro: las propias y las del grupo que comparte.
  const sites = await ca.companyAttendanceSites(A.id);
  assert.deepEqual(sites.map((s) => s.id).sort(), [A.siteId, B.siteId].sort());
});

test("companyAttendance: si el grupo no comparte empleados, solo cuentan los equipos propios", async () => {
  const g = await group(false);
  const A = await company("NA", g);
  const B = await company("NB", g);
  const devA = await device("ndevA", A.siteId);
  const devB = await device("ndevB", B.siteId);
  const dani = ced(4);
  await contract(await employee(dani), A.id, "2026-09-01");
  await mark(devA, dani, "20260910080000");
  await mark(devB, dani, "20260910170000");

  const rows = await ca.companyAttendance(A.id);
  assert.deepEqual(rows.map((r) => r.io_time), ["20260910080000"]);
  assert.deepEqual((await ca.companyAttendanceSites(A.id)).map((s) => s.id), [A.siteId]);
});
