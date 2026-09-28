// ADD_EMPLOYEES_BATCH (lib/operations/batch.ts) y el candado por equipo
// (lib/handlers/protocol-handlers.ts) — docs/10 §4.2 "Escritura en lote".
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
const batch = require("../lib/operations/batch") as typeof import("../lib/operations/batch");
const handlers = require("../lib/handlers/protocol-handlers") as typeof import("../lib/handlers/protocol-handlers");
const { NextRequest } = require("next/server") as typeof import("next/server");
const { prisma } = db;

const P = `BAT_${Date.now()}_`;
const DEVS = ["OK", "USERS", "FPS", "LOCK"].map((s) => P + s);
const [DEV_OK, DEV_USERS, DEV_FPS, DEV_LOCK] = DEVS;
const employees: number[] = [];
let cedulaSeq = 71000000 + Math.floor(Math.random() * 100000) * 10;

after(async () => {
  await db.runAsync(`DELETE FROM commands WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM operations WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM users WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await db.runAsync(`DELETE FROM enroll_data WHERE dev_id = ANY(?::text[])`, [DEVS]);
  await prisma.devices.deleteMany({ where: { dev_id: { in: DEVS } } });
  await prisma.employee.deleteMany({ where: { id: { in: employees } } });
  await prisma.$disconnect();
});

const template = (userId: number) => {
  const b = Buffer.alloc(612, 0xcd);
  b.writeUInt32LE(userId, 608);
  return b;
};

async function person(fingerprints: number) {
  const cedula = String(++cedulaSeq);
  const e = await prisma.employee.create({ data: { national_id: "V" + cedula, first_name: "B", last_name: P } });
  employees.push(e.id);
  for (let i = 0; i < fingerprints; i++) {
    await prisma.employee_fingerprint.create({ data: { employee_id: e.id, template: template(Number(cedula)) } });
  }
  return { employeeId: e.id, cedula, name: "B " + cedula };
}

async function current(opId: number) {
  return (await ops.getOperationCommands(opId)).at(-1)!;
}

async function reply(devId: string, opId: number, ok: boolean, resultJson: Record<string, unknown> | null = null, returnCode?: string) {
  const cmd = await current(opId);
  await advance.advanceOperationForCommand({
    opId, devId, transId: cmd.trans_id, cmdCode: cmd.cmd_code, ok,
    returnCode: returnCode ?? (ok ? "OK" : "Error"), resultJson: resultJson as Record<string, any> | null, binaries: [],
  });
}

const status = (users: number, fp: number) => ({ total_user_count: String(users), fp_count: String(fp) });

/** Responde OK a cada escritura (el código no se usa) y devuelve los comandos enviados. */
async function ackWrites(devId: string, opId: number, code: string): Promise<Array<Record<string, any>>> {
  const sent: Array<Record<string, any>> = [];
  while ((await current(opId)).cmd_code === code) {
    sent.push(JSON.parse((await current(opId)).cmd_param ?? "{}"));
    await reply(devId, opId, true);
  }
  return sent;
}

test("lote - todo cierra por conteo: crea, vincula y copia huellas sin un solo GET_USER_INFO", async () => {
  await prisma.devices.create({ data: { dev_id: DEV_OK, last_seen_at: BigInt(Date.now()) } });
  const a = await person(2); // nueva, 2 huellas
  const b = await person(0); // nueva, sin huellas
  const c = await person(1); // ya está en el equipo (caché), le falta la huella
  await db.runAsync(`INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, ?, 'c', 'USER')`, [DEV_OK, c.cedula]);

  const opId = await batch.startAddEmployeesBatch(DEV_OK, [a, b, c]);
  assert.equal((await current(opId)).cmd_code, "GET_DEVICE_STATUS");
  await reply(DEV_OK, opId, true, status(10, 4));

  const created = await ackWrites(DEV_OK, opId, "SET_USER_INFO");
  assert.deepEqual(created.map((p) => p.user_id).sort(), [a.cedula, b.cedula].sort(), "a quien está en caché nunca se le manda SET_USER_INFO");
  assert.equal((await current(opId)).cmd_code, "GET_DEVICE_STATUS");
  await reply(DEV_OK, opId, true, status(12, 4));

  const pushed = await ackWrites(DEV_OK, opId, "SET_ENROLL_DATA");
  assert.equal(pushed.length, 3);
  assert.deepEqual(pushed.filter((p) => p.user_id === a.cedula).map((p) => p.backup_number), [0, 1], "slots libres consecutivos");
  await reply(DEV_OK, opId, true, status(12, 7));

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done", op?.note ?? "");
  const cmds = await ops.getOperationCommands(opId);
  assert.equal(cmds.filter((x) => x.cmd_code === "GET_USER_INFO").length, 0);
  assert.equal(await prisma.device_fingerprint_slot.count({ where: { dev_id: DEV_OK } }), 3);
  assert.equal(await prisma.employee_device_enrollment.count({ where: { dev_id: DEV_OK, status: "active" } }), 3);
  assert.equal(await prisma.users.count({ where: { dev_id: DEV_OK } }), 3);
  const run = await prisma.sync_run.findFirst({ where: { op_id: opId } });
  assert.equal(run, null, "un lote no abre corrida propia");
});

test("lote - el total de usuarios no cierra: relee a los creados; quien no contesta queda para la próxima", async () => {
  await prisma.devices.create({ data: { dev_id: DEV_USERS, last_seen_at: BigInt(Date.now()) } });
  const a = await person(1);
  const b = await person(1);
  const opId = await batch.startAddEmployeesBatch(DEV_USERS, [a, b]);
  await reply(DEV_USERS, opId, true, status(3, 1));
  await ackWrites(DEV_USERS, opId, "SET_USER_INFO");
  await reply(DEV_USERS, opId, true, status(4, 1)); // +1 en vez de +2

  const asked: string[] = [];
  while ((await current(opId)).cmd_code === "GET_USER_INFO") {
    const uid = JSON.parse((await current(opId)).cmd_param ?? "{}").user_id as string;
    asked.push(uid);
    if (uid === a.cedula) await reply(DEV_USERS, opId, true, { user_id: uid, user_name: "a", user_privilege: "USER" });
    else await reply(DEV_USERS, opId, false, null, "TIMEOUT");
  }
  assert.deepEqual(asked.sort(), [a.cedula, b.cedula].sort());
  assert.equal((await current(opId)).cmd_code, "GET_DEVICE_STATUS", "nueva línea de base de huellas");
  await reply(DEV_USERS, opId, true, status(4, 1));

  const pushed = await ackWrites(DEV_USERS, opId, "SET_ENROLL_DATA");
  assert.deepEqual(pushed.map((p) => p.user_id), [a.cedula], "solo al confirmado");
  await reply(DEV_USERS, opId, true, status(4, 2));

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", new RegExp(`sin confirmar.*${b.cedula}`));
  assert.equal(await prisma.employee_device_enrollment.count({ where: { dev_id: DEV_USERS, device_user_id: b.cedula } }), 0, "sin vincular");
});

test("lote - el total de huellas no cierra: relee y registra solo los slots que el equipo reporta", async () => {
  await prisma.devices.create({ data: { dev_id: DEV_FPS, last_seen_at: BigInt(Date.now()) } });
  const a = await person(2);
  const opId = await batch.startAddEmployeesBatch(DEV_FPS, [a]);
  await reply(DEV_FPS, opId, true, status(0, 0));
  await ackWrites(DEV_FPS, opId, "SET_USER_INFO");
  await reply(DEV_FPS, opId, true, status(1, 0));
  await ackWrites(DEV_FPS, opId, "SET_ENROLL_DATA");
  await reply(DEV_FPS, opId, true, status(1, 1)); // +1 en vez de +2

  assert.equal((await current(opId)).cmd_code, "GET_USER_INFO");
  await reply(DEV_FPS, opId, true, {
    user_id: a.cedula, user_name: "a", user_privilege: "USER",
    enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
  });
  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  const slots = await prisma.device_fingerprint_slot.findMany({ where: { dev_id: DEV_FPS }, select: { backup_number: true, origin: true } });
  assert.deepEqual(slots, [{ backup_number: 0, origin: "propagated" }]);
});

test("candado por equipo - una operación a la vez: la que arrancó sigue, la del panel pasa antes que la de fondo", async () => {
  await prisma.devices.create({ data: { dev_id: DEV_LOCK, last_seen_at: BigInt(Date.now()) } });
  const poll = async () => {
    const res = await handlers.handleReceiveCmd(new NextRequest("http://device.local/"), Buffer.alloc(0), DEV_LOCK);
    return { transId: res.headers.get("trans_id"), cmd: res.headers.get("cmd_code") };
  };
  const a = await person(0);
  const bg = await batch.startAddEmployeesBatch(DEV_LOCK, [a]); // fondo (200), primero
  const first = await poll();
  assert.equal(first.cmd, "GET_DEVICE_STATUS");
  assert.equal(Number(first.transId), (await current(bg)).trans_id, "el lote arranca");

  const panel = (await ops.startSyncClock(DEV_LOCK)).id; // panel (100), llega con el lote en curso
  await reply(DEV_LOCK, bg, true, status(0, 0)); // → SET_USER_INFO del lote en cola
  const second = await poll();
  assert.equal(second.cmd, "SET_USER_INFO", "el lote que arrancó no se interrumpe aunque el panel tenga más prioridad");
  await reply(DEV_LOCK, bg, true);
  assert.equal((await poll()).cmd, "GET_DEVICE_STATUS");
  await reply(DEV_LOCK, bg, true, status(1, 0));
  assert.equal((await ops.getOperation(bg))?.stage, "done");

  assert.equal((await poll()).cmd, "SET_TIME", "terminado el lote, pasa el panel");
  await reply(DEV_LOCK, panel, true);
});
