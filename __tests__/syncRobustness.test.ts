// Hallazgos del equipo 2023054254 (2026-09-27/28): lista vacía como
// ERROR_NO_USER, marcaciones en lote, y corridas que quedaban abiertas cuando
// su operación expiraba.
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
const ops = require("../lib/operations") as typeof import("../lib/operations");
const advance = require("../lib/operations/advance") as typeof import("../lib/operations/advance");
const persist = require("../lib/operations/persist") as typeof import("../lib/operations/persist");
const reconcile = require("../lib/sync/reconcile") as typeof import("../lib/sync/reconcile");
const { prisma } = db;

const P = `ROB_${Date.now()}_`;
const DEV_EMPTY = P + "EMPTY";
const DEV_FP = P + "FP";
const DEV_LOGS = P + "LOGS";
const DEV_SWEEP = P + "SWEEP";
const DEV_OFF = P + "OFF";
const DEVS = [DEV_EMPTY, DEV_FP, DEV_LOGS, DEV_SWEEP, DEV_OFF];
const companies: number[] = [];

after(async () => {
  await db.runAsync(`DELETE FROM attendance_logs WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM commands WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM operations WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await prisma.devices.deleteMany({ where: { dev_id: { in: DEVS } } });
  await prisma.client_company.deleteMany({ where: { id: { in: companies } } });
  await prisma.$disconnect();
});

async function assignedDevice(devId: string) {
  const c = await prisma.client_company.create({
    data: { name: P + devId, tax_id: "J-" + devId.slice(-6), sites: { create: { name: "S" } } },
    include: { sites: true },
  });
  companies.push(c.id);
  await prisma.devices.create({ data: { dev_id: devId, site_id: c.sites[0].id, last_seen_at: BigInt(Date.now()) } });
}

async function step(devId: string, opId: number, ok: boolean, returnCode: string, resultJson: Record<string, unknown> | null) {
  const cmd = (await ops.getOperationCommands(opId)).at(-1)!;
  await advance.advanceOperationForCommand({
    opId, devId, transId: cmd.trans_id, cmdCode: cmd.cmd_code, ok, returnCode,
    resultJson: resultJson as Record<string, any> | null, binaries: [],
  });
}

test("reconcile - equipo sin huellas: ERROR_NO_USER al listar es una lista vacía, no un fallo", async () => {
  await assignedDevice(DEV_EMPTY);
  const opId = (await reconcile.startReconcileDevice(DEV_EMPTY, { trigger: "manual", force: true }))!;
  await step(DEV_EMPTY, opId, true, "OK", { fp_count: "0", total_user_count: "0" });
  await step(DEV_EMPTY, opId, false, "ERROR_NO_USER", null);

  assert.equal((await ops.getOperation(opId))?.stage, "done");
  const run = await prisma.sync_run.findFirst({ where: { op_id: opId } });
  assert.equal(run?.ok, true);
});

test("reconcile - con huellas en el equipo, ERROR_NO_USER sigue siendo una lectura fallida", async () => {
  await assignedDevice(DEV_FP);
  const opId = (await reconcile.startReconcileDevice(DEV_FP, { trigger: "manual", force: true }))!;
  await step(DEV_FP, opId, true, "OK", { fp_count: "3", total_user_count: "2" });
  await step(DEV_FP, opId, false, "ERROR_NO_USER", null);

  assert.equal((await ops.getOperation(opId))?.stage, "error");
  assert.equal((await prisma.sync_run.findFirst({ where: { op_id: opId } }))?.ok, false);
});

test("marcaciones - en lote: duplicados dentro del lote y contra lo ya guardado se descartan; más de un lote", async () => {
  const e = (user_id: string, io_time: string) => ({ user_id, verify_mode: "1", io_mode: 0, io_time });
  await persist.insertAttendanceLogs(DEV_LOGS, [e("1", "20260927080000")]);

  const many = Array.from({ length: 12_000 }, (_, i) => e(String(i % 50), `2026092${7 + Math.floor(i / 6000)}${String(i).padStart(6, "0")}`));
  const batch = [e("1", "20260927080000"), e("2", "20260927080100"), e("2", "20260927080100"), ...many];
  const t0 = Date.now();
  const s = await persist.insertAttendanceLogs(DEV_LOGS, batch);
  const ms = Date.now() - t0;

  assert.equal(s.total, batch.length);
  assert.equal(s.inserted, 1 + many.length, "solo entra una copia de '2' y ninguna de '1'");
  assert.equal(s.skipped, 2);
  const n = await db.getAsync<{ n: number }>(`SELECT count(*)::int AS n FROM attendance_logs WHERE dev_id = ?`, [DEV_LOGS]);
  assert.equal(n?.n, 2 + many.length);
  assert.ok(ms < 10_000, `12 000 marcaciones en ${ms} ms`);
});

test("expiración - la corrida de una operación que expira sin respuesta queda cerrada (ok = false)", async () => {
  await assignedDevice(DEV_SWEEP);
  const opId = (await reconcile.startReconcileDevice(DEV_SWEEP, { trigger: "cron" }))!;
  await db.runAsync(`UPDATE operations SET updated_at = updated_at - 11 * 60 * 1000 WHERE id = ?`, [opId]);
  await advance.sweepStaleOperations();

  assert.equal((await ops.getOperation(opId))?.stage, "error");
  const run = await prisma.sync_run.findFirst({ where: { op_id: opId } });
  assert.equal(run?.ok, false);
  assert.ok(run?.finished_at, "con hora de cierre");
  // Y ya no se traga la siguiente corrida: arranca una nueva.
  const next = await reconcile.startReconcileDevice(DEV_SWEEP, { trigger: "cron" });
  assert.notEqual(next, opId);
});

test("equipo fuera - sin corridas automáticas; manual sí; al volver, corrida con revisión y pull de asistencia", async () => {
  await assignedDevice(DEV_OFF);
  await db.runAsync(`UPDATE devices SET last_seen_at = ? WHERE dev_id = ?`, [Date.now() - 6 * 60 * 1000, DEV_OFF]);

  assert.equal(await reconcile.startReconcileDevice(DEV_OFF, { trigger: "cron" }), null, "cron: no queda colgada esperando a un equipo que no está");
  assert.equal(await reconcile.startReconcileDevice(DEV_OFF, { trigger: "event" }), null);
  const attendance = require("../lib/sync/attendance") as typeof import("../lib/sync/attendance");
  assert.deepEqual(await attendance.attendancePullDevices([DEV_OFF], "cron"), []);

  // Vuelve a consultar.
  await db.runAsync(`UPDATE devices SET last_seen_at = ? WHERE dev_id = ?`, [Date.now(), DEV_OFF]);
  await reconcile.onDeviceReconnect(DEV_OFF);
  const launched = await db.allAsync<{ kind: string; label: string }>(
    `SELECT kind, label FROM operations WHERE dev_id = ? ORDER BY id`,
    [DEV_OFF]
  );
  assert.deepEqual(launched.map((o) => o.kind), ["RECONCILE_DEVICE", "SYNC_LOGS"]);
  assert.match(launched[0].label, /al reconectarse, con revisión/);
});
