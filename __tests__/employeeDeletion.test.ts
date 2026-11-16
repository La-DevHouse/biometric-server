// Eliminar a una persona (lib/employeeDeletion, docs/18): solo sin contrato abierto.
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
const del = require("../lib/employeeDeletion") as typeof import("../lib/employeeDeletion");
const access = require("../lib/access") as typeof import("../lib/access");
const { prisma } = db;

const P = `EDEL_${Date.now()}_`;
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
let seq = 0;
const created = { companies: [] as number[], employees: [] as number[], devices: [] as string[] };
const DAY = 86_400_000;
const ymd = (offsetDays: number) => new Date(new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10) + "T00:00:00Z");

after(async () => {
  await prisma.attendance_logs.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.users.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.audit_log.deleteMany({ where: { action: "employee.delete", entity_id: { in: created.employees.map(String) } } });
  await prisma.$disconnect();
});

async function company() {
  const c = await prisma.client_company.create({
    data: { name: P + "Empresa", tax_id: "J-00000000-0", sites: { create: { name: "S" } } },
    include: { sites: true },
  });
  created.companies.push(c.id);
  return { id: c.id, siteId: c.sites[0].id, name: c.name };
}

async function person() {
  const nationalId = `V-7${++seq}${SEED}`;
  const e = await prisma.employee.create({ data: { national_id: nationalId, first_name: "Prueba", last_name: P } });
  created.employees.push(e.id);
  return { id: e.id, digits: nationalId.replace(/\D/g, "") };
}

test("no se elimina con un contrato vigente, ni con uno que todavía no empieza", async () => {
  const c = await company();
  const vigente = await person();
  await prisma.employment.create({ data: { employee_id: vigente.id, company_id: c.id, start_date: ymd(-30) } });
  const futuro = await person();
  await prisma.employment.create({ data: { employee_id: futuro.id, company_id: c.id, start_date: ymd(7) } });

  for (const p of [vigente, futuro]) {
    assert.deepEqual((await del.employeeDeletionInfo(p.id))?.openWith, [c.name]);
    const r = await del.deleteEmployee(p.id, null);
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : "", /tiene contrato vigente con/);
    assert.ok(await prisma.employee.findUnique({ where: { id: p.id } }), "sigue existiendo");
  }
});

test("con un contrato que termina hoy todavía no se puede; con la baja en el pasado, sí", async () => {
  const c = await company();
  const p = await person();
  const em = await prisma.employment.create({ data: { employee_id: p.id, company_id: c.id, start_date: ymd(-60), end_date: ymd(0) } });
  assert.equal((await del.deleteEmployee(p.id, null)).ok, false);
  await prisma.employment.update({ where: { id: em.id }, data: { end_date: ymd(-1), status: "inactive" } });
  assert.equal((await del.deleteEmployee(p.id, null)).ok, true);
});

test("sin contrato abierto: borra la persona, sus contratos cerrados, días y huellas; conserva sus marcaciones", async () => {
  const c = await company();
  const devId = P + "DEV";
  await prisma.devices.create({ data: { dev_id: devId, name: P + "Equipo", site_id: c.siteId } });
  created.devices.push(devId);
  const p = await person();
  const em = await prisma.employment.create({
    data: { employee_id: p.id, company_id: c.id, start_date: ymd(-90), end_date: ymd(-10), status: "inactive" },
  });
  await prisma.attendance_day.create({ data: { employee_id: p.id, employment_id: em.id, date: ymd(-20) } });
  await prisma.employee_fingerprint.create({ data: { employee_id: p.id, template: Buffer.alloc(612) } });
  await prisma.attendance_logs.create({ data: { dev_id: devId, user_id: p.digits, io_time: "20261001080000", employee_id: p.id } });
  await prisma.users.create({ data: { dev_id: devId, user_id: p.digits, user_name: "Prueba" } });

  const info = await del.employeeDeletionInfo(p.id);
  assert.deepEqual(
    { ...info, devices: info?.devices },
    { openWith: [], closedContracts: 1, attendanceDays: 1, corrections: 0, fingerprints: 1, marks: 1, devices: [P + "Equipo"] }
  );

  const r = await del.deleteEmployee(p.id, null);
  assert.equal(r.ok, true);
  assert.equal(await prisma.employee.count({ where: { id: p.id } }), 0);
  assert.equal(await prisma.employment.count({ where: { employee_id: p.id } }), 0);
  assert.equal(await prisma.attendance_day.count({ where: { employment_id: em.id } }), 0);
  assert.equal(await prisma.employee_fingerprint.count({ where: { employee_id: p.id } }), 0);
  const mark = await prisma.attendance_logs.findFirst({ where: { dev_id: devId, user_id: p.digits } });
  assert.ok(mark, "la marcación se conserva");
  assert.equal(mark?.employee_id, null);

  const audit = await prisma.audit_log.findFirst({ where: { action: "employee.delete", entity_id: String(p.id) } });
  const before = audit?.before_json as { national_id?: string; contracts?: unknown[] } | null;
  assert.equal(before?.national_id?.replace(/\D/g, ""), p.digits, "la auditoría guarda una copia de sus datos");
  assert.equal(before?.contracts?.length, 1);
});

test("solo un administrador puede eliminar", async () => {
  const c = await company();
  const p = await person();
  await prisma.employment.create({ data: { employee_id: p.id, company_id: c.id, start_date: ymd(-90), end_date: ymd(-10), status: "inactive" } });
  type Access = import("../lib/access").Access;
  const as = (isAdmin: boolean, canEdit: boolean, companyIds: number[] | null): Access =>
    ({ user: { id: 0 } as Access["user"], isAdmin, canEdit, canEditFingerprints: isAdmin, companyIds });
  const need = { admin: true, employee: p.id };
  assert.equal((await access.checkAccess(as(false, false, null), need)).ok, false, "Solo lectura");
  assert.equal((await access.checkAccess(as(false, true, [c.id]), need)).ok, false, "Socio, aun con la empresa de la persona");
  assert.equal((await access.checkAccess(as(true, true, null), need)).ok, true, "Administrador");
});

test("una persona que no existe", async () => {
  assert.equal(await del.employeeDeletionInfo(-1), null);
  const r = await del.deleteEmployee(-1, null);
  assert.equal(r.ok, false);
});
