// Reintento de comandos que los faciales rechazan al azar con "Error"
// (lib/handlers/protocol-handlers.ts → shouldRetryCommand / requeueCommand).
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
const handlers = require("../lib/handlers/protocol-handlers") as typeof import("../lib/handlers/protocol-handlers");
const queue = require("../lib/operations/queue") as typeof import("../lib/operations/queue");
const { NextRequest } = require("next/server") as typeof import("next/server");
const { prisma } = db;

const DEV = `RTY${Date.now()}`;

after(async () => {
  await db.runAsync(`DELETE FROM commands WHERE dev_id = ?`, [DEV]);
  await db.runAsync(`DELETE FROM operations WHERE dev_id = ?`, [DEV]);
  await prisma.devices.deleteMany({ where: { dev_id: DEV } });
  await prisma.$disconnect();
});

const result = (transId: number, rc: string) =>
  handlers.handleSendCmdResult(
    new NextRequest("http://device.local/", { headers: { trans_id: String(transId), cmd_return_code: rc } }),
    Buffer.alloc(0),
    "000000000001"
  );

test("shouldRetryCommand: solo 'Error' literal, solo lectura/escritura de huella, con tope", () => {
  assert.ok(handlers.shouldRetryCommand("GET_USER_INFO", "Error", 0));
  assert.ok(handlers.shouldRetryCommand("SET_ENROLL_DATA", "Error", 9));
  assert.ok(!handlers.shouldRetryCommand("SET_ENROLL_DATA", "Error", 10));
  assert.ok(!handlers.shouldRetryCommand("SET_USER_INFO", "Error", 0)); // reindexado destructivo si ya existía
  assert.ok(!handlers.shouldRetryCommand("GET_USER_INFO", "ERROR_NO_USER", 0));
  assert.ok(!handlers.shouldRetryCommand("GET_USER_INFO", "OK", 0));
});

test("un 'Error' de un facial se reencola y la operación sigue en el mismo paso", async () => {
  await prisma.devices.create({ data: { dev_id: DEV, fk_name: DEV, reported_dev_id: "000000000001" } });
  const opId = await queue.createOperation({ kind: "VIEW_BIOMETRICS", label: "t", devId: DEV });
  const first = await queue.queueCommandForOperation(opId, DEV, "GET_USER_INFO", { user_id: "123" });
  await db.runAsync(`UPDATE commands SET status = 'RUN' WHERE trans_id = ?`, [first]);

  await result(first, "Error");

  const rows = await db.allAsync<{ trans_id: number; status: string; attempt: number; cmd_param: string; op_id: number }>(
    `SELECT trans_id, status, attempt, cmd_param, op_id FROM commands WHERE dev_id = ? ORDER BY trans_id`,
    [DEV]
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, "ERROR");
  assert.deepEqual(
    { status: rows[1].status, attempt: rows[1].attempt, param: JSON.parse(rows[1].cmd_param), op: rows[1].op_id },
    { status: "WAIT", attempt: 1, param: { user_id: "123" }, op: opId }
  );
  const op = await queue.getOperationRow(opId);
  assert.equal(op?.current_trans_id, rows[1].trans_id);
  assert.ok(op && !["done", "error"].includes(op.stage), "la operación no se enteró del error");

  // Agotados los reintentos, el error sí llega a la operación.
  await db.runAsync(`UPDATE commands SET attempt = 10, status = 'RUN' WHERE trans_id = ?`, [rows[1].trans_id]);
  await result(rows[1].trans_id, "Error");
  const count = await db.allAsync(`SELECT 1 FROM commands WHERE dev_id = ?`, [DEV]);
  assert.equal(count.length, 2);
  assert.equal((await queue.getOperationRow(opId))?.stage, "error");
});
