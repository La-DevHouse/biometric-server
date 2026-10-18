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
const ops = require("../lib/operations") as typeof import("../lib/operations");
const { NextRequest } = require("next/server") as typeof import("next/server");
const { prisma } = db;

const PLACEHOLDER = "000000000001";
const P = `IDT${Date.now()}`;
const FACE_A = `${P}A`;
const FACE_B = `${P}B`;
const NORMAL = `${P}N`;
const FK_DEV = `FK_${P}`;
const SERIAL = `9${String(Date.now()).slice(-9)}`;
const DEVS = [FACE_A, FACE_B, NORMAL, PLACEHOLDER, FK_DEV, SERIAL];

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

test("shouldPullPlaceholderLogs: solo con marcaciones y algo nuevo (o pull pendiente)", () => {
  const f = handlers.shouldPullPlaceholderLogs;
  // 0 marcaciones: el facial no respondería GET_LOG_DATA.
  assert.equal(f({ newCount: 0, prevCount: null, prevStatAt: null, lastSyncAt: null }), false);
  assert.equal(f({ newCount: null, prevCount: 5, prevStatAt: 1, lastSyncAt: null }), false);
  // Nunca se trajeron.
  assert.equal(f({ newCount: 3, prevCount: 3, prevStatAt: 100, lastSyncAt: null }), true);
  // Cambió el conteo.
  assert.equal(f({ newCount: 4, prevCount: 3, prevStatAt: 100, lastSyncAt: 200 }), true);
  // Igual y ya traídas después de la revisión anterior.
  assert.equal(f({ newCount: 3, prevCount: 3, prevStatAt: 100, lastSyncAt: 200 }), false);
  // Igual, pero el pull que disparó la revisión anterior no terminó: reintenta.
  assert.equal(f({ newCount: 3, prevCount: 3, prevStatAt: 300, lastSyncAt: 200 }), true);
});

test("placeholder: la revisión periódica es un GET_DEVICE_STATUS suelto, no un GET_LOG_DATA", async () => {
  await poll(PLACEHOLDER, FACE_A);
  const cmds = await db.allAsync<{ cmd_code: string }>(
    `SELECT cmd_code FROM commands WHERE dev_id = ? AND cmd_code IN ('GET_DEVICE_STATUS','GET_LOG_DATA')`,
    [FACE_A]
  );
  assert.ok(cmds.some((c) => c.cmd_code === "GET_DEVICE_STATUS"));
  assert.ok(!cmds.some((c) => c.cmd_code === "GET_LOG_DATA"));
});


test("corregir serial: un facial con nombre de fábrica pasa al serial de la caja, con lo suyo", async () => {
  await poll(PLACEHOLDER, FK_DEV); // llega con el nombre de fábrica
  await db.runAsync(`INSERT INTO users (dev_id, user_id, user_name) VALUES (?, '123', 'x')`, [FK_DEV]);

  // Validaciones: equipo normal, serial ocupado, serial = placeholder.
  await assert.rejects(ops.startSetDeviceSerial(NORMAL, "1234567890"), /ya se identifica por su serial/);
  await assert.rejects(ops.startSetDeviceSerial(FK_DEV, FACE_A), /Ya hay un equipo/);
  await assert.rejects(ops.startSetDeviceSerial(FK_DEV, PLACEHOLDER), /genérico/);

  const { id } = await ops.startSetDeviceSerial(FK_DEV, SERIAL);
  // Se cuela el GET_DEVICE_STATUS automático de los faciales: se consulta hasta que salga el SET_FK_NAME.
  let transId = 0;
  for (let i = 0; i < 4 && !transId; i++) {
    const res = await poll(PLACEHOLDER, FK_DEV);
    if (res.headers.get("cmd_code") === "SET_FK_NAME") transId = Number(res.headers.get("trans_id"));
  }
  assert.ok(transId, "el equipo recibe el SET_FK_NAME");

  // Un "Error" al azar se reintenta (no mueve nada todavía).
  await handlers.handleSendCmdResult(req({ trans_id: String(transId), cmd_return_code: "Error" }), Buffer.alloc(0), PLACEHOLDER);
  assert.ok(await prisma.devices.findUnique({ where: { dev_id: FK_DEV } }));
  const retry = await poll(PLACEHOLDER, FK_DEV);
  assert.equal(retry.headers.get("cmd_code"), "SET_FK_NAME");

  await handlers.handleSendCmdResult(
    req({ trans_id: String(retry.headers.get("trans_id")), cmd_return_code: "OK" }),
    Buffer.alloc(0),
    PLACEHOLDER
  );
  assert.equal(await prisma.devices.findUnique({ where: { dev_id: FK_DEV } }), null, "el nombre viejo ya no existe");
  const moved = await prisma.devices.findUnique({ where: { dev_id: SERIAL }, select: { fk_name: true } });
  assert.equal(moved?.fk_name, SERIAL);
  assert.equal((await db.allAsync(`SELECT 1 FROM users WHERE dev_id = ?`, [SERIAL])).length, 1, "sus usuarios lo siguen");
  assert.equal((await db.getAsync<{ stage: string }>(`SELECT stage FROM operations WHERE id = ?`, [id]))?.stage, "done");

  // Su próxima consulta ya llega con el serial: mismo registro, no uno nuevo.
  await poll(PLACEHOLDER, SERIAL);
  assert.equal(await prisma.devices.count({ where: { dev_id: { in: [FK_DEV, SERIAL] } } }), 1);
  await db.runAsync(`DELETE FROM users WHERE dev_id = ?`, [SERIAL]);
});
