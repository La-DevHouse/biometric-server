// Reportes del período (lib/attendance/reports.ts, lib/export/reports.ts, docs/17).
import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import ExcelJS from "exceljs";

{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const engine = require("../lib/attendance/engine") as typeof import("../lib/attendance/engine");
const reports = require("../lib/attendance/reports") as typeof import("../lib/attendance/reports");
const xlsx = require("../lib/export/reports") as typeof import("../lib/export/reports");
const corrections = require("../lib/attendance/corrections") as typeof import("../lib/attendance/corrections");
const { prisma } = db;

const P = `REP_${Date.now()}_`;
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

test("consolidado e incidencias de una semana, y sus .xlsx", async () => {
  const actor = await prisma.app_user.create({ data: { email: `${P}@test`, name: "Supervisora", password_hash: "x" } });
  created.users.push(actor.id);
  const company = await prisma.client_company.create({
    data: { name: P + "Co", tax_id: "J-00000000-0", sites: { create: { name: "Principal" } } },
    include: { sites: true },
  });
  created.companies.push(company.id);
  const dev = P + "dev";
  await prisma.devices.create({ data: { dev_id: dev, site_id: company.sites[0].id } });
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
  const person = async (n: number, last: string, scheduled: boolean) => {
    const cedula = `7${n}${SEED}`;
    const e = await prisma.employee.create({ data: { national_id: `V-${cedula}`, first_name: "T", last_name: last + P } });
    created.employees.push(e.id);
    const em = await prisma.employment.create({
      data: {
        employee_id: e.id,
        company_id: company.id,
        start_date: new Date("2026-09-01T00:00:00Z"),
        schedule_group_id: scheduled ? g.id : null,
        payroll_ref: `N-${n}`,
      },
    });
    return { cedula, employeeId: e.id, employmentId: em.id };
  };
  const ana = await person(1, "A", true);
  const beto = await person(2, "B", true);
  const caro = await person(3, "C", false); // sin horario: solo horas

  // Semana lunes 10-05 … viernes 10-09.
  for (const d of ["05", "06", "07", "08", "09"]) {
    await mark(dev, ana.cedula, `202610${d}075500`);
    await mark(dev, ana.cedula, `202610${d}170000`);
  }
  await mark(dev, ana.cedula, "20261010090000"); // sábado: día libre trabajado (3 h extra)
  await mark(dev, ana.cedula, "20261010120000");
  await mark(dev, beto.cedula, "20261005083000"); // tardanza 30 y salida anticipada 60
  await mark(dev, beto.cedula, "20261005160000");
  // martes: ausente
  await mark(dev, beto.cedula, "20261007080000"); // miércoles: incompleto
  await mark(dev, beto.cedula, "20261008080000");
  await mark(dev, beto.cedula, "20261008170000");
  await mark(dev, beto.cedula, "20261009081500"); // viernes: tardanza 15
  await mark(dev, beto.cedula, "20261009170000");
  await mark(dev, caro.cedula, "20261006090000");
  await mark(dev, caro.cedula, "20261006130000");
  await engine.computeCompanyAttendance(company.id, "2026-10-05", "2026-10-11", { today: "2026-10-19" });
  // Corrección: a Beto le falta la salida del miércoles.
  const r = await corrections.addMark(
    { employmentId: beto.employmentId, ymd: "2026-10-07", time: "17:00", siteId: company.sites[0].id, reason: "Olvidó marcar la salida" },
    actor.id
  );
  assert.equal(r.ok, true);

  const sum = await reports.companySummary(company.id, "2026-10-05", "2026-10-11");
  const by = Object.fromEntries(sum.map((s) => [s.employmentId, s]));
  assert.deepEqual(sum.map((s) => s.employmentId), [ana.employmentId, beto.employmentId, caro.employmentId]);
  const a = by[ana.employmentId];
  assert.equal(a.workdays, 5);
  assert.equal(a.daysWorked, 6);
  assert.equal(a.workedMinutes, 5 * (9 * 60 + 5) + 180);
  assert.equal(a.overtimeMinutes, 5 * 65 + 180);
  assert.equal(a.restDaysWorked, 1);
  assert.equal(a.lates + a.absences + a.incomplete, 0);
  assert.equal(a.payrollRef, "N-1");
  const b = by[beto.employmentId];
  assert.deepEqual(
    [b.workdays, b.daysWorked, b.lates, b.lateMinutes, b.earlyLeaves, b.earlyLeaveMinutes, b.absences, b.incomplete, b.corrections],
    [5, 4, 2, 45, 1, 60, 1, 0, 1]
  );
  const c = by[caro.employmentId];
  assert.deepEqual([c.workdays, c.daysWorked, c.workedMinutes, c.noScheduleDays, c.scheduleName], [0, 1, 240, 1, null]);

  const inc = await reports.companyIncidents(company.id, "2026-10-05", "2026-10-11");
  assert.deepEqual(
    inc.map((i) => [i.date, i.kind, i.minutes, i.time]),
    [
      ["2026-10-05", "late", 30, null],
      ["2026-10-05", "early_leave", 60, null],
      ["2026-10-06", "absent", null, null],
      ["2026-10-07", "mark_added", null, "17:00"],
      ["2026-10-09", "late", 15, null],
    ]
  );
  assert.equal(inc[3].reason, "Olvidó marcar la salida");
  assert.equal(inc[3].actor, "Supervisora");

  // .xlsx: encabezado, títulos en la fila 6, una fila por contrato, números como números.
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(
    (await xlsx.buildSummaryXlsx({ companyName: "ACME", from: "2026-10-05", to: "2026-10-11", generatedAt: new Date(), rows: sum })) as never
  );
  const ws = wb.getWorksheet("Consolidado")!;
  assert.equal(ws.getCell("A1").value, "Consolidado de asistencia");
  assert.equal(ws.getCell("A3").value, "Período: 05/10/2026 al 11/10/2026");
  assert.equal(ws.getCell("A6").value, "Cédula");
  assert.equal(ws.getCell("A8").value, beto.cedula);
  assert.equal(ws.getCell("G7").value, Math.round(((5 * 545 + 180) / 60) * 100) / 100);
  assert.equal(ws.getCell("J8").value, 45);
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(
    (await xlsx.buildIncidentsXlsx({ companyName: "ACME", from: "2026-10-05", to: "2026-10-11", generatedAt: new Date(), rows: inc })) as never
  );
  const ws2 = wb2.getWorksheet("Incidencias")!;
  assert.deepEqual([ws2.getCell("A7").value, ws2.getCell("D7").value, ws2.getCell("E7").value], ["05/10/2026", "Tardanza", 30]);
  assert.deepEqual([ws2.getCell("D10").value, ws2.getCell("G10").value, ws2.getCell("H10").value], ["Marcación agregada a mano", "Olvidó marcar la salida", "Supervisora"]);
  assert.equal(xlsx.reportFileName("ACME: S.A.", "Consolidado", "2026-10-01", "2026-10-15"), "ACME S.A. Consolidado 20261001_20261015.xlsx");
});

test("períodos a un clic: quincenas y meses, sin pasar de ayer", () => {
  assert.deepEqual(reports.periodPresets("2026-10-19"), [
    { label: "Quincena en curso", from: "2026-10-16", to: "2026-10-18" },
    { label: "Quincena anterior", from: "2026-10-01", to: "2026-10-15" },
    { label: "Mes en curso", from: "2026-10-01", to: "2026-10-18" },
    { label: "Mes anterior", from: "2026-09-01", to: "2026-09-30" },
  ]);
  assert.deepEqual(reports.periodPresets("2026-01-01"), [
    { label: "Quincena anterior", from: "2025-12-16", to: "2025-12-31" },
    { label: "Mes anterior", from: "2025-12-01", to: "2025-12-31" },
  ]);
  assert.deepEqual(reports.periodPresets("2026-03-10")[1], { label: "Quincena anterior", from: "2026-02-16", to: "2026-02-28" });
});
