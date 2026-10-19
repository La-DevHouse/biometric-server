// Motor de asistencia con base de datos (lib/attendance/engine.ts, docs/16).
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
const engine = require("../lib/attendance/engine") as typeof import("../lib/attendance/engine");
const { prisma } = db;

const P = `ENG_${Date.now()}_`;
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
const ced = (n: number) => `5${n}${SEED}`;
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

async function setup() {
  const c = await prisma.client_company.create({
    data: { name: P + "Co", tax_id: "J-00000000-0", sites: { create: { name: "Principal" } } },
    include: { sites: true },
  });
  created.companies.push(c.id);
  const dev = P + "dev" + created.devices.length;
  await prisma.devices.create({ data: { dev_id: dev, site_id: c.sites[0].id } });
  created.devices.push(dev);
  return { companyId: c.id, dev };
}

async function person(companyId: number, n: number, scheduleGroupId: number | null) {
  const e = await prisma.employee.create({ data: { national_id: `V-${ced(n)}`, first_name: "T", last_name: P + n } });
  created.employees.push(e.id);
  const em = await prisma.employment.create({
    data: { employee_id: e.id, company_id: companyId, start_date: new Date("2026-09-01T00:00:00Z"), schedule_group_id: scheduleGroupId },
  });
  return { employeeId: e.id, employmentId: em.id, userId: ced(n) };
}

async function group(companyId: number, name: string, shift: { start: string; end: string; workdays: number[]; brk?: [string, string]; hours?: number }) {
  const g = await prisma.schedule_group.create({
    data: {
      company_id: companyId,
      name: P + name,
      shifts: {
        create: {
          name,
          start_time: shift.start,
          end_time: shift.end,
          break_start: shift.brk?.[0] ?? null,
          break_end: shift.brk?.[1] ?? null,
          hours: shift.hours ?? null,
          workdays: shift.workdays,
          effective_from: new Date("2026-01-01T00:00:00Z"),
        },
      },
    },
  });
  return g.id;
}

const mark = (dev: string, userId: string, io: string) =>
  db.runAsync(`INSERT INTO attendance_logs (dev_id, user_id, io_time) VALUES (?, ?, ?)`, [dev, userId, io]);

const days = async (employmentId: number) =>
  Object.fromEntries(
    (
      await prisma.attendance_day.findMany({
        where: { employment_id: employmentId },
        orderBy: { date: "asc" },
        select: { date: true, status: true, late_minutes: true, early_leave_minutes: true, worked_minutes: true, overtime_minutes: true },
      })
    ).map((d) => [d.date.toISOString().slice(0, 10), d])
  );

test("una semana de turno diurno: cada estado, y recalcular no duplica", async () => {
  const { companyId, dev } = await setup();
  const g = await group(companyId, "Diurno", { start: "08:00", end: "17:00", workdays: [1, 2, 3, 4, 5], brk: ["12:00", "13:00"], hours: 8 });
  const p = await person(companyId, 1, g);
  // Lunes 2026-10-05 … domingo 10-11.
  await mark(dev, p.userId, "20261005075800");
  await mark(dev, p.userId, "20261005170200");
  await mark(dev, p.userId, "20261006082000"); // tardanza 20
  await mark(dev, p.userId, "20261006170000");
  // miércoles 7: nada → ausente
  await mark(dev, p.userId, "20261008080000"); // jueves: una sola → incompleto
  await mark(dev, p.userId, "20261009080000");
  await mark(dev, p.userId, "20261009163000"); // viernes: salida anticipada 30
  await mark(dev, p.userId, "20261010090000"); // sábado: día libre trabajado
  await mark(dev, p.userId, "20261010120000");
  // domingo 11: día libre

  const s1 = await engine.computeCompanyAttendance(companyId, "2026-10-05", "2026-10-11", { today: "2026-10-12" });
  const d = await days(p.employmentId);
  assert.deepEqual(
    Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.status])),
    {
      "2026-10-05": "present",
      "2026-10-06": "late",
      "2026-10-07": "absent",
      "2026-10-08": "incomplete",
      "2026-10-09": "early_leave",
      "2026-10-10": "rest_day_worked",
      "2026-10-11": "rest_day",
    }
  );
  assert.equal(d["2026-10-05"].worked_minutes, 9 * 60 + 4 - 60);
  assert.equal(d["2026-10-05"].overtime_minutes, 4);
  assert.equal(d["2026-10-06"].late_minutes, 20);
  assert.equal(d["2026-10-09"].early_leave_minutes, 30);
  assert.equal(d["2026-10-10"].overtime_minutes, 180);
  assert.equal(s1.days, 7);

  // Recalcular: mismos 7 días, sin duplicar.
  await engine.computeCompanyAttendance(companyId, "2026-10-05", "2026-10-11", { today: "2026-10-12" });
  assert.equal(await prisma.attendance_day.count({ where: { employment_id: p.employmentId } }), 7);

  // Nunca calcula hoy ni el futuro.
  await engine.computeCompanyAttendance(companyId, "2026-10-12", "2026-10-20", { today: "2026-10-12" });
  assert.equal(await prisma.attendance_day.count({ where: { employment_id: p.employmentId } }), 7);

  // El contrato termina el jueves: viernes a domingo se borran al recalcular.
  await prisma.employment.update({ where: { id: p.employmentId }, data: { end_date: new Date("2026-10-08T00:00:00Z") } });
  const s2 = await engine.computeCompanyAttendance(companyId, "2026-10-05", "2026-10-11", { today: "2026-10-12" });
  assert.equal(s2.removed, 3);
  assert.deepEqual(Object.keys(await days(p.employmentId)), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"]);
});

test("turno nocturno y persona sin horario", async () => {
  const { companyId, dev } = await setup();
  const g = await group(companyId, "Nocturno", { start: "22:00", end: "06:00", workdays: [1, 2, 3, 4, 5, 6, 7] });
  const night = await person(companyId, 2, g);
  await mark(dev, night.userId, "20261005215800");
  await mark(dev, night.userId, "20261006060300"); // salida del turno del lunes
  const free = await person(companyId, 3, null);
  await mark(dev, free.userId, "20261005090000");
  await mark(dev, free.userId, "20261005150000");

  await engine.computeCompanyAttendance(companyId, "2026-10-05", "2026-10-05", { today: "2026-10-12" });
  const n = await days(night.employmentId);
  assert.equal(n["2026-10-05"].status, "present");
  assert.equal(n["2026-10-05"].worked_minutes, 8 * 60 + 5);

  const f = await days(free.employmentId);
  assert.deepEqual(Object.keys(f), ["2026-10-05"], "sin horario: solo los días que marcó");
  assert.equal(f["2026-10-05"].status, "no_schedule");
  assert.equal(f["2026-10-05"].worked_minutes, 360);
});

test("rango por defecto: los últimos 35 días cerrados, hasta ayer", () => {
  assert.deepEqual(engine.defaultComputeRange("2026-10-19"), { from: "2026-09-14", to: "2026-10-18" });
});

test("corrida de todas las empresas: no se cae si no hay nada que calcular", async () => {
  const r = await engine.computeAllCompanies();
  assert.equal(r.failed, 0);
  assert.ok(r.companies >= 1);
});
