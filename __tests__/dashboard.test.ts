// Inicio (lib/dashboard.ts): conteos de ayer, atención y alcance por empresa.
import { test, after } from "node:test";
import { strict as assert } from "node:assert";

{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const { dashboard } = require("../lib/dashboard") as typeof import("../lib/dashboard");
const { prisma } = db;

const P = `DSH_${Date.now()}_`;
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
const created = { companies: [] as number[], employees: [] as number[], devices: [] as string[] };

after(async () => {
  await prisma.attendance_logs.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.attendance_day.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.$disconnect();
});

test("ayer por empresa, atención y alcance", async () => {
  const d0 = await dashboard(null);
  const yesterday = new Date(`${d0.yesterday}T00:00:00Z`);
  const today = d0.today.replace(/-/g, "");

  const company = async (n: number) => {
    const c = await prisma.client_company.create({ data: { name: `${P}Co${n}`, sites: { create: { name: "S" } } }, include: { sites: true } });
    created.companies.push(c.id);
    const dev = `${P}dev${n}`;
    await prisma.devices.create({ data: { dev_id: dev, site_id: c.sites[0].id } });
    created.devices.push(dev);
    return { id: c.id, dev };
  };
  const A = await company(1);
  const B = await company(2);

  const person = async (n: number, companyId: number, status: "present" | "late" | "absent", late?: number) => {
    const e = await prisma.employee.create({ data: { national_id: `V-6${n}${SEED}`, first_name: "T", last_name: `${P}${n}` } });
    created.employees.push(e.id);
    const em = await prisma.employment.create({ data: { employee_id: e.id, company_id: companyId, start_date: new Date("2026-01-01T00:00:00Z") } });
    await prisma.attendance_day.create({
      data: { employment_id: em.id, employee_id: e.id, date: yesterday, status, late_minutes: late ?? null, mark_count: status === "absent" ? 0 : 2 },
    });
    return e;
  };
  await person(1, A.id, "present");
  await person(2, A.id, "late", 12);
  await person(3, A.id, "absent");
  const b1 = await person(4, B.id, "present");

  // Marcaciones de hoy: una de una persona de B y una de un ID sin empleado en A.
  await db.runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time) VALUES (?, ?, ?)`, [B.dev, b1.national_id.replace(/\D/g, ""), `${today}080000`]);
  await db.runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time) VALUES (?, ?, ?)`, [A.dev, "999", `${today}081500`]);

  // Solo la empresa A (como un Socio).
  const a = await dashboard([A.id]);
  assert.equal(a.companies, 1);
  assert.equal(a.people, 3);
  assert.deepEqual(
    { present: a.day.present, late: a.day.late, absent: a.day.absent, total: a.day.total },
    { present: 1, late: 1, absent: 1, total: 3 }
  );
  assert.deepEqual(a.perCompany.map((c) => [c.id, c.contracts, c.withoutSchedule]), [[A.id, 3, 3]]);
  assert.equal(a.attention.withoutSchedule, 3);
  assert.equal(a.attention.unmatchedIds, 1, "el ID 999 no es de nadie");
  assert.equal(a.marksToday, 1);
  assert.deepEqual(a.devices.offline.map((x) => x.devId), [A.dev]);
  assert.equal(a.devices.unassigned, 0);
  assert.equal(a.recent.some((r) => r.device === B.dev), false, "no ve las marcaciones de la otra empresa");
  assert.equal(a.recent.find((r) => r.device === A.dev)?.person, "ID 999");

  // Las dos empresas: A primero (más incidencias); la persona de B por su nombre.
  const both = await dashboard([A.id, B.id]);
  assert.deepEqual(both.perCompany.map((c) => c.id), [A.id, B.id]);
  assert.equal(both.recent.find((r) => r.device === B.dev)?.employeeId, b1.id);
});
