// Correcciones manuales de marcaciones (lib/attendance/corrections.ts, docs/16 paso 4).
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
const corrections = require("../lib/attendance/corrections") as typeof import("../lib/attendance/corrections");
const { companyAttendance } = require("../lib/companyAttendance") as typeof import("../lib/companyAttendance");
const engine = require("../lib/attendance/engine") as typeof import("../lib/attendance/engine");
const { prisma } = db;

const P = `COR_${Date.now()}_`;
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
const created = { companies: [] as number[], employees: [] as number[], devices: [] as string[], users: [] as number[] };

after(async () => {
  await prisma.attendance_logs.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.attendance_day.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.audit_log.deleteMany({ where: { actor_app_user_id: { in: created.users } } });
  await prisma.app_user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.$disconnect();
});

const mark = (dev: string, userId: string, io: string) =>
  db.runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time) VALUES (?, ?, ?)`, [dev, userId, io]);
const logId = async (dev: string, io: string) =>
  (await prisma.attendance_logs.findFirstOrThrow({ where: { dev_id: dev, io_time: io }, select: { id: true } })).id;
const day = async (employmentId: number, ymd: string) =>
  prisma.attendance_day.findUniqueOrThrow({
    where: { employment_id_date: { employment_id: employmentId, date: new Date(`${ymd}T00:00:00Z`) } },
    select: { status: true, late_minutes: true, first_in: true },
  });

test("agregar, anular y deshacer: el día se recalcula y attendance_logs no se toca", async () => {
  const actor = await prisma.app_user.create({ data: { email: `${P}@test`, name: "Correctora", password_hash: "x" } });
  created.users.push(actor.id);
  const company = await prisma.client_company.create({
    data: { name: P + "Co", tax_id: "J-00000000-0", sites: { create: { name: "Principal" } } },
    include: { sites: true },
  });
  created.companies.push(company.id);
  const other = await prisma.client_company.create({
    data: { name: P + "Otra", tax_id: "J-00000000-1", sites: { create: { name: "Ajena" } } },
    include: { sites: true },
  });
  created.companies.push(other.id);
  const siteId = company.sites[0].id;
  const dev = P + "dev";
  await prisma.devices.create({ data: { dev_id: dev, name: "Entrada", site_id: siteId } });
  created.devices.push(dev);
  const g = await prisma.schedule_group.create({
    data: {
      company_id: company.id,
      name: P + "Diurno",
      shifts: {
        create: { name: "D", start_time: "08:00", end_time: "17:00", hours: 8, workdays: [1, 2, 3, 4, 5], effective_from: new Date("2026-01-01T00:00:00Z") },
      },
    },
  });
  const cedula = `6${SEED}`;
  const e = await prisma.employee.create({ data: { national_id: `V-${cedula}`, first_name: "T", last_name: P } });
  created.employees.push(e.id);
  const em = await prisma.employment.create({
    data: { employee_id: e.id, company_id: company.id, start_date: new Date("2026-09-01T00:00:00Z"), schedule_group_id: g.id },
  });

  // Lunes 10-05: olvidó marcar la salida → incompleto.
  await mark(dev, cedula, "20261005080000");
  // Martes 10-06: una marcación de las 07:00 que no es de él (error), llegó 08:20.
  await mark(dev, cedula, "20261006070000");
  await mark(dev, cedula, "20261006082000");
  await mark(dev, cedula, "20261006170000");
  const logsBefore = await prisma.attendance_logs.count({ where: { dev_id: dev } });
  await engine.computeCompanyAttendance(company.id, "2026-10-05", "2026-10-06");
  assert.equal((await day(em.id, "2026-10-05")).status, "incomplete");
  assert.equal((await day(em.id, "2026-10-06")).status, "present");

  // Validaciones.
  const base = { employmentId: em.id, ymd: "2026-10-05", time: "17:00", siteId, reason: "Olvidó marcar la salida" };
  assert.deepEqual(await corrections.addMark({ ...base, reason: "x" }, actor.id), {
    ok: false,
    error: "Indique el motivo de la corrección (al menos 5 caracteres).",
  });
  assert.equal((await corrections.addMark({ ...base, siteId: other.sites[0].id }, actor.id)).ok, false);
  assert.equal((await corrections.addMark({ ...base, ymd: "2026-08-20" }, actor.id)).ok, false); // antes del contrato
  assert.equal((await corrections.addMark({ ...base, ymd: "2099-01-01" }, actor.id)).ok, false); // futura

  // Agregar la salida: presente, y la marcación manual sale en lo que se exporta.
  assert.deepEqual(await corrections.addMark(base, actor.id), { ok: true, companyId: company.id, employeeId: e.id });
  assert.equal((await day(em.id, "2026-10-05")).status, "present");
  const exported = await companyAttendance(company.id, { from: "2026-10-05", to: "2026-10-05", order: "asc" });
  assert.deepEqual(
    exported.map((r) => [r.io_time, r.manual, r.national_id]),
    [
      ["20261005080000", false, `V-${cedula}`],
      ["20261005170000", true, `V-${cedula}`],
    ]
  );
  const mon = (await corrections.dayMarks(em.id, "2026-10-05"))!;
  assert.deepEqual(
    mon.marks.map((m) => [m.time, m.manual, m.device, m.correction?.reason ?? null, m.correction?.actor ?? null]),
    [
      ["08:00", false, "Entrada", null, null],
      ["17:00", true, "Corrección manual", "Olvidó marcar la salida", "Correctora"],
    ]
  );
  assert.deepEqual(mon.sites.map((s) => s.id), [siteId]);
  assert.equal(mon.defaultSiteId, siteId);

  // Anular la de las 07:00: la entrada pasa a 08:20 → tardanza de 20.
  const wrong = await logId(dev, "20261006070000");
  const v = await corrections.voidMark({ employmentId: em.id, logId: wrong, reason: "No era de él" }, actor.id);
  assert.equal(v.ok, true);
  const tue = await day(em.id, "2026-10-06");
  assert.equal(tue.status, "late");
  assert.equal(tue.late_minutes, 20);
  const tueMarks = (await corrections.dayMarks(em.id, "2026-10-06"))!;
  assert.deepEqual(tueMarks.marks.map((m) => m.time), ["08:20", "17:00"]);
  assert.deepEqual(tueMarks.voided.map((x) => [x.logId, x.time, x.correction.reason]), [[wrong, "07:00", "No era de él"]]);
  // Dos veces no.
  assert.equal((await corrections.voidMark({ employmentId: em.id, logId: wrong, reason: "No era de él" }, actor.id)).ok, false);

  // Deshacer la anulación: vuelve a presente; deshacer dos veces no.
  const voidId = tueMarks.voided[0].correction.id;
  assert.equal((await corrections.revokeCorrection(voidId, actor.id)).ok, true);
  assert.equal((await day(em.id, "2026-10-06")).status, "present");
  assert.equal((await corrections.revokeCorrection(voidId, actor.id)).ok, false);
  const revoked = await prisma.attendance_correction.findUniqueOrThrow({ where: { id: voidId } });
  assert.ok(revoked.revoked_at);
  assert.equal(revoked.revoked_by_app_user_id, actor.id);
  // Deshacer la agregada: el lunes vuelve a incompleto.
  assert.equal((await corrections.revokeCorrection(mon.marks[1].correction!.id, actor.id)).ok, true);
  assert.equal((await day(em.id, "2026-10-05")).status, "incomplete");

  // Lo del equipo, intacto. Todo quedó en la auditoría.
  assert.equal(await prisma.attendance_logs.count({ where: { dev_id: dev } }), logsBefore);
  const audit = await prisma.audit_log.findMany({ where: { actor_app_user_id: actor.id }, orderBy: { id: "asc" }, select: { action: true } });
  assert.deepEqual(audit.map((a) => a.action), [
    "attendance.correction.add_mark",
    "attendance.correction.void_mark",
    "attendance.correction.revoke",
    "attendance.correction.revoke",
  ]);
});
