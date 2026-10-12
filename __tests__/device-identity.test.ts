// Identidad de equipos con dev_id placeholder (lib/deviceIdentity.ts): los
// faciales WS545CW_FP3FC5_BSCS_V2.0.33 mandan siempre dev_id 000000000001 y el
// serial real en fk_name.
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
const identity = require("../lib/deviceIdentity") as typeof import("../lib/deviceIdentity");
const handlers = require("../lib/handlers/protocol-handlers") as typeof import("../lib/handlers/protocol-handlers");
const { NextRequest } = require("next/server") as typeof import("next/server");
const { prisma } = db;

const PLACEHOLDER = "000000000001";
const P = `IDT${Date.now()}`;
const FACE_A = `${P}A`;
const FACE_B = `${P}B`;
const NORMAL = `${P}N`;
const DEVS = [FACE_A, FACE_B, NORMAL, PLACEHOLDER];

after(async () => {
  await db.runAsync(`DELETE FROM commands WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM operations WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM attendance_logs WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await prisma.devices.deleteMany({ where: { dev_id: { in: DEVS } } });
  await prisma.$disconnect();
});

function body(json: unknown): Buffer {
  const payload = Buffer.from(JSON.stringify(json), "utf-8");
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(payload.length, 0);
  return Buffer.concat([prefix, payload]);
}

const req = (headers: Record<string, string> = {}) => new NextRequest("http://device.local/", { headers });
const poll = (reported: string, fkName: string | null) =>
  handlers.handleReceiveCmd(
    req(),
    body({ fk_name: fkName ?? "", fk_info: { firmware: "WS545CW_FP3FC5_BSCS_V2.0.33" } }),
    reported
  );

test("resolveDeviceIdentity: dev_id normal, placeholder con serial y cuarentena", () => {
  assert.deepEqual(identity.resolveDeviceIdentity("2023081158", "Oficina"), {
    kind: "serial",
    devId: "2023081158",
    reported: "2023081158",
  });
  assert.deepEqual(identity.resolveDeviceIdentity(PLACEHOLDER, " 2401058627 "), {
    kind: "fk_name",
    devId: "2401058627",
    reported: PLACEHOLDER,
  });
  assert.equal(identity.resolveDeviceIdentity(PLACEHOLDER, "").kind, "quarantine");
  assert.equal(identity.resolveDeviceIdentity(PLACEHOLDER, null).kind, "quarantine");
  assert.equal(identity.resolveDeviceIdentity(PLACEHOLDER, PLACEHOLDER).kind, "quarantine");
});

test("PLACEHOLDER_DEV_IDS amplía la lista", () => {
  const prev = process.env.PLACEHOLDER_DEV_IDS;
  process.env.PLACEHOLDER_DEV_IDS = "000000000001, 999";
  try {
    assert.ok(identity.isPlaceholderDevId("999"));
    assert.ok(identity.isPlaceholderDevId(PLACEHOLDER));
    assert.ok(!identity.isPlaceholderDevId("2023081158"));
  } finally {
    if (prev === undefined) delete process.env.PLACEHOLDER_DEV_IDS;
    else process.env.PLACEHOLDER_DEV_IDS = prev;
  }
});

test("dos faciales con el mismo dev_id placeholder quedan como equipos distintos", async () => {
  await poll(PLACEHOLDER, FACE_A);
  await poll(PLACEHOLDER, FACE_B);
  const rows = await prisma.devices.findMany({
    where: { dev_id: { in: [FACE_A, FACE_B, PLACEHOLDER] } },
    select: { dev_id: true, fk_name: true, reported_dev_id: true },
    orderBy: { dev_id: "asc" },
  });
  assert.deepEqual(rows, [
    { dev_id: FACE_A, fk_name: FACE_A, reported_dev_id: PLACEHOLDER },
    { dev_id: FACE_B, fk_name: FACE_B, reported_dev_id: PLACEHOLDER },
  ]);
  // Su fk_name es la identidad: nunca se reescribe.
  const heal = await db.allAsync(`SELECT 1 FROM commands WHERE dev_id = ANY(?::text[]) AND cmd_code = 'SET_FK_NAME'`, [
    [FACE_A, FACE_B],
  ]);
  assert.equal(heal.length, 0);
});

test("placeholder con fk_name vacío: cuarentena (ni se registra ni recibe comandos)", async () => {
  await prisma.devices.deleteMany({ where: { dev_id: PLACEHOLDER } });
  const res = await poll(PLACEHOLDER, "");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cmd_code"), null);
  assert.equal(await prisma.devices.count({ where: { dev_id: PLACEHOLDER } }), 0);
});

test("send_cmd_result de un placeholder se atribuye por trans_id", async () => {
  const { lastID } = await db.runAsync(
    `INSERT INTO commands (dev_id, cmd_code, cmd_param, status) VALUES (?, 'GET_DEVICE_STATUS', '{}', 'RUN') RETURNING trans_id`,
    [FACE_B]
  );
  await handlers.handleSendCmdResult(
    req({ trans_id: String(lastID), cmd_return_code: "OK" }),
    body({ total_user_count: 7 }),
    PLACEHOLDER
  );
  const b = await prisma.devices.findUnique({ where: { dev_id: FACE_B }, select: { stat_user_count: true } });
  const a = await prisma.devices.findUnique({ where: { dev_id: FACE_A }, select: { stat_user_count: true } });
  assert.equal(b?.stat_user_count, 7);
  assert.equal(a?.stat_user_count, null);
});

test("realtime_glog de un placeholder no se guarda (entra por el pull de GET_LOG_DATA)", async () => {
  const before = await prisma.attendance_logs.count({ where: { dev_id: { in: [PLACEHOLDER, FACE_A, FACE_B] } } });
  const res = await handlers.handleRealtimeGlog(
    req(),
    body({ user_id: "12345678", verify_mode: "FACE", io_mode: "0", io_time: "20261012080000" }),
    PLACEHOLDER
  );
  assert.equal(res.status, 200);
  const afterCount = await prisma.attendance_logs.count({ where: { dev_id: { in: [PLACEHOLDER, FACE_A, FACE_B] } } });
  assert.equal(afterCount, before);
});

test("equipo normal con fk_name cambiado: se reescribe con su serial, una sola vez", async () => {
  await poll(NORMAL, "Oficina");
  await poll(NORMAL, "Oficina"); // el SET_FK_NAME sale en esta consulta
  await poll(NORMAL, "Oficina"); // el equipo aún no lo aplicó: no se duplica
  const cmds = await db.allAsync<{ cmd_param: string; priority: number }>(
    `SELECT cmd_param, priority FROM commands WHERE dev_id = ? AND cmd_code = 'SET_FK_NAME'`,
    [NORMAL]
  );
  assert.equal(cmds.length, 1);
  assert.deepEqual(JSON.parse(cmds[0].cmd_param), { fk_name: NORMAL });
  assert.equal(cmds[0].priority, 300);

  // Con el serial ya puesto no se encola nada.
  await db.runAsync(`DELETE FROM commands WHERE dev_id = ?`, [NORMAL]);
  await poll(NORMAL, NORMAL);
  const again = await db.allAsync(`SELECT 1 FROM commands WHERE dev_id = ?`, [NORMAL]);
  assert.equal(again.length, 0);
});
