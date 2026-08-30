import { test } from "node:test";
import { strict as assert } from "node:assert";

// lib/db.ts reads DATABASE_URL at module-eval time. A static `import` of
// lib/db (or anything that transitively imports it) would be hoisted above
// this assignment by the CommonJS transpile tsx applies — so the env var has
// to be set before an explicit `require()`, which is NOT hoisted. Verified
// empirically before relying on it here.
//
// Los tests corren contra una base Postgres separada (biometric_test),
// creada y migrada por scripts/test-db-setup.ts (el `pretest` de npm).
{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ??
    base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const ops = require("../lib/operations") as typeof import("../lib/operations");
const advance = require("../lib/operations/advance") as typeof import("../lib/operations/advance");
const persist = require("../lib/operations/persist") as typeof import("../lib/operations/persist");

const DEV_A = "TEST_DEV_A";

async function freshDb() {
  await db.initDb();
  await db.execAsync(
    `DELETE FROM operations; DELETE FROM commands; DELETE FROM devices;
     DELETE FROM users; DELETE FROM attendance_logs; DELETE FROM enroll_data;`
  );
  await db.runAsync(
    `INSERT INTO devices (dev_id, last_seen_at) VALUES (?, ${db.NOW_MS})`,
    [DEV_A]
  );
}

/** Reads the command a fresh operation queued, so tests can complete it. */
async function currentCommand(opId: number) {
  const op = await ops.getOperation(opId);
  assert.ok(op, `operation ${opId} should exist`);
  const commands = await ops.getOperationCommands(opId);
  const last = commands[commands.length - 1];
  assert.ok(last, `operation ${opId} should have queued a command`);
  return last;
}

/**
 * Simulates the device reporting a result for an operation's current
 * command. In production, protocol-handlers.ts's handleSendCmdResult always
 * runs handleCommandResult (which persists GET_USER_INFO/GET_DEVICE_STATUS
 * results into `users`/`devices`) *before* advanceOperationForCommand — this
 * mirrors that order so a unit test of the chain sees the same side effects
 * real device traffic would produce, rather than testing advance.ts in an
 * artificial isolation it never actually runs in.
 */
async function completeCurrentStep(
  opId: number,
  result: { ok: boolean; returnCode?: string; resultJson?: Record<string, any> | null; binaries?: Buffer[] }
) {
  const cmd = await currentCommand(opId);
  if (result.ok && result.resultJson) {
    if (cmd.cmd_code === "GET_USER_INFO") {
      await persist.upsertUserFromInfo(DEV_A, result.resultJson, result.binaries ?? []);
    } else if (cmd.cmd_code === "GET_DEVICE_STATUS") {
      await persist.upsertDeviceStatus(DEV_A, result.resultJson);
    }
  }
  await advance.advanceOperationForCommand({
    opId,
    devId: DEV_A,
    transId: cmd.trans_id,
    cmdCode: cmd.cmd_code,
    ok: result.ok,
    returnCode: result.returnCode ?? (result.ok ? "OK" : "Error"),
    resultJson: result.resultJson ?? null,
    binaries: result.binaries ?? [],
  });
}

// --- Attendance dedup idempotence ---

test("insertAttendanceLogs - same batch inserted twice: N then 0", async () => {
  await freshDb();
  const entries = [
    { user_id: "1", verify_mode: "1", io_mode: 0, io_time: "20260101120000" },
    { user_id: "1", verify_mode: "1", io_mode: 0, io_time: "20260101120005" },
    { user_id: "2", verify_mode: "33", io_mode: 0, io_time: "20260101130000" },
  ];

  const first = await persist.insertAttendanceLogs(DEV_A, entries);
  assert.equal(first.inserted, 3);
  assert.equal(first.skipped, 0);

  const second = await persist.insertAttendanceLogs(DEV_A, entries);
  assert.equal(second.inserted, 0);
  assert.equal(second.skipped, 3);

  const rows = await db.allAsync(`SELECT * FROM attendance_logs WHERE dev_id = ?`, [DEV_A]);
  assert.equal(rows.length, 3, "no duplicates persisted");
});

test("insertAttendanceLogs - never overwrites a realtime row's log_image", async () => {
  await freshDb();
  await db.runAsync(
    `INSERT INTO attendance_logs (dev_id, user_id, verify_mode, io_mode, io_time, log_image)
     VALUES (?, '5', '1', 0, '20260101120000', ?)`,
    [DEV_A, Buffer.from("fake-image-bytes")]
  );

  await persist.insertAttendanceLogs(DEV_A, [
    { user_id: "5", verify_mode: "1", io_mode: 0, io_time: "20260101120000" },
  ]);

  const row = await db.getAsync<{ log_image: Buffer | null }>(
    `SELECT log_image FROM attendance_logs WHERE dev_id = ? AND user_id = '5'`,
    [DEV_A]
  );
  assert.ok(row?.log_image, "the realtime row with its image must survive untouched");
});

// --- SYNC_USERS chain progression ---

test("SYNC_USERS - progresses through the list then each user, then finishes done", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncUsers(DEV_A);

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "queued");

  // Step 1: GET_USER_ID_LIST resolves with 2 users. The device frames this
  // as a length-prefixed uint32 array, matching lib/protocol.ts's verified
  // decodeUserIdList shape: 8-byte records, first 4 bytes = user_id LE.
  const userIdBinary = Buffer.concat([
    numLE(1), Buffer.from([1, 1, 8, 0]),
    numLE(2), Buffer.from([1, 1, 8, 0]),
  ]);
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id_count: 2, one_user_id_size: 8, user_id_array: "BIN_1" },
    binaries: [userIdBinary],
  });

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  assert.equal(op?.step_total, 3); // list + 2 users
  assert.equal(op?.progressLabel, "Paso 1 de 3");

  // Step 2: first GET_USER_INFO
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "ana", user_privilege: "USER" },
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  assert.equal(op?.progressLabel, "Paso 2 de 3");

  // Step 3: second GET_USER_INFO — chain should finish.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "2", user_name: "bruno", user_privilege: "MANAGER" },
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.equal(op?.isTerminal, true);
  assert.match(op!.note ?? "", /2 usuarios sincronizados/);

  const users = await db.allAsync(`SELECT user_id, user_name FROM users WHERE dev_id = ? ORDER BY user_id`, [DEV_A]);
  assert.deepEqual(
    users.map((u: any) => u.user_id),
    ["1", "2"]
  );
});

test("SYNC_USERS - never prunes local users, since the id list is not a complete roster", async () => {
  await freshDb();
  // Verified against real hardware: GET_USER_ID_LIST silently excludes
  // USER-privilege / no-fingerprint-yet accounts (GET_DEVICE_STATUS
  // reported 6 total users while it listed only the 3 with fingerprints).
  // A prior version of this sync deleted any local user not in this list —
  // that would have wiped real, still-existing accounts. "9" here stands in
  // for exactly that kind of account: real on the device, invisible to
  // this particular list.
  await db.runAsync(
    `INSERT INTO users (dev_id, user_id, user_name) VALUES (?, '9', 'sin-huella-aun')`,
    [DEV_A]
  );

  const { id: opId } = await ops.startSyncUsers(DEV_A);
  const userIdBinary = Buffer.concat([numLE(1), Buffer.from([1, 1, 8, 0])]);
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id_count: 1, one_user_id_size: 8, user_id_array: "BIN_1" },
    binaries: [userIdBinary],
  });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "ana", user_privilege: "USER" },
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");

  const notPruned = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.ok(notPruned, "a local user absent from this list must survive — the list is known incomplete");
});

test("SYNC_USERS - a device reporting zero users finishes done without a decode error", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncUsers(DEV_A);
  await completeCurrentStep(opId, { ok: true, resultJson: { user_id_count: 0 } });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /no tiene usuarios registrados/);
});

test("SYNC_USERS - one failing GET_USER_INFO does not abort the chain", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncUsers(DEV_A);

  const userIdBinary = Buffer.concat([numLE(7), Buffer.from([1, 1, 8, 0])]);
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id_count: 1, one_user_id_size: 8, user_id_array: "BIN_1" },
    binaries: [userIdBinary],
  });

  // The one GET_USER_INFO fails.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error"); // all failed with none synced
  assert.match(op!.note ?? "", /1 con error/);
});

// --- CHANGE_PRIVILEGE mismatch path ---

test("CHANGE_PRIVILEGE - OPERATOR that the device silently ignores ends in mismatch", async () => {
  await freshDb();
  const { id: opId, warning } = await ops.startChangePrivilege(DEV_A, "3", "OPERATOR");
  assert.match(warning ?? "", /solo aplica MANAGER/);

  // Apply step: SET_USER_PRIVILEGE often returns OK with an empty body.
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");

  // Verify step: the device kept USER instead of applying OPERATOR.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "3", user_name: "c", user_privilege: "USER" },
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /sigue siendo "USER"/);
});

test("CHANGE_PRIVILEGE - MANAGER that the device applies ends in done", async () => {
  await freshDb();
  const { id: opId } = await ops.startChangePrivilege(DEV_A, "3", "MANAGER");

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "3", user_name: "c", user_privilege: "MANAGER" },
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /verificado en el dispositivo/);
});

// --- CREATE_USER: probes and verifies with GET_USER_INFO ---
//
// GET_USER_ID_LIST was tried for both (a naturally reliable-sounding
// alternative to dodge GET_USER_INFO's occasional hang) and reverted:
// verified against real hardware, it silently excludes USER-privilege /
// no-fingerprint-yet accounts — GET_DEVICE_STATUS reported 6 total users
// while it listed only the 3 with fingerprints. It cannot be trusted to
// say an id is free, which matters a lot here: SET_USER_INFO over an id
// that's actually taken triggers the destructive reindex.

test("CREATE_USER - id already on the device refuses to create", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "7", userName: "nueva" });

  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "7", user_name: "vieja", user_privilege: "USER" },
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  assert.match(op!.note ?? "", /Ya existe el usuario 7 \("vieja"\)/);

  const commands = await ops.getOperationCommands(opId);
  assert.equal(commands.length, 1, "must never send SET_USER_INFO once the id is known to exist");
});

test("CREATE_USER - a free id proceeds to SET_USER_INFO, verifies, then finishes done", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "9", userName: "nueva" });

  // Probe: GET_USER_INFO fails/empty — the id is free.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_INFO");

  // Apply: SET_USER_INFO reports OK. Not trusted on its own — see below.
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO", "verifies by re-querying the same id");

  // Verify: a fresh GET_USER_INFO now finds the new user.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "9", user_name: "nueva", user_privilege: "USER" },
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");

  const row = await db.getAsync<{ user_name: string; user_privilege: string }>(
    `SELECT user_name, user_privilege FROM users WHERE dev_id = ? AND user_id = '9'`,
    [DEV_A]
  );
  assert.equal(row?.user_name, "nueva", "the new user must show up locally without a manual sync");
  assert.equal(row?.user_privilege, "USER");
});

test("CREATE_USER - device reports OK but the user was never actually created ends in mismatch", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "9", userName: "nueva" });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // SET_USER_INFO "succeeds"

  // Verify: GET_USER_INFO still finds nothing.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /No se pudo verificar la creación/);

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.equal(row, undefined, "must not be cached locally when it was never verified on the device");
});

// --- DELETE_USER: apply's return code is untrustworthy, verify decides ---

test("DELETE_USER - device reports Error but the user is actually gone ends in done", async () => {
  await freshDb();
  await db.runAsync(
    `INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, '9', 'zed', 'USER')`,
    [DEV_A]
  );

  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");

  // Apply: verified against real hardware that DELETE_USER can report
  // cmd_return_code "Error" for a deletion that actually succeeded.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");

  // Verify: GET_USER_INFO comes back empty — the id is free, deletion worked.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /verificado/);

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.equal(row, undefined, "the local cache row must be cleaned up on a verified deletion");
});

test("DELETE_USER - device reports OK but the user still exists ends in mismatch", async () => {
  await freshDb();
  await db.runAsync(
    `INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, '9', 'zed', 'USER')`,
    [DEV_A]
  );

  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");

  // Verify: GET_USER_INFO still finds the user — the deletion didn't apply.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "9", user_name: "zed", user_privilege: "USER" },
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /sigue existiendo/);

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.ok(row, "the local cache must not be touched when deletion did not verify");
});

// --- Terminal guard against resurrection ---

test("advanceOperationForCommand - ignores a result for an already-terminal operation", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncClock(DEV_A);
  const cmd = await currentCommand(opId);

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  const noteAfterFirstCompletion = op!.note;

  // The same command "resolves" again (e.g. a stray duplicate delivery).
  await advance.advanceOperationForCommand({
    opId,
    devId: DEV_A,
    transId: cmd.trans_id,
    cmdCode: cmd.cmd_code,
    ok: false,
    returnCode: "Error",
    resultJson: null,
    binaries: [],
  });

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done", "a terminal operation must not be reopened");
  assert.equal(op?.note, noteAfterFirstCompletion);
});

// --- Idempotence guard on start* ---

test("startSyncClock - a second call while one is in flight returns the same operation", async () => {
  await freshDb();
  const first = await ops.startSyncClock(DEV_A);
  const second = await ops.startSyncClock(DEV_A);
  assert.equal(first.id, second.id);

  const active = await ops.listActiveOperations(DEV_A);
  assert.equal(active.filter((o) => o.kind === "SYNC_CLOCK").length, 1);
});

// --- Manual cancellation ---

test("cancelOperation - a queued command not yet delivered is canceled cleanly", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncClock(DEV_A);
  const cmd = await currentCommand(opId);
  assert.equal(cmd.status, "WAIT");

  const result = await ops.cancelOperation(opId);
  assert.equal(result.ok, true);

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "canceled");
});

test("cancelOperation - a command already delivered to the device can still be canceled", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncClock(DEV_A);
  const cmd = await currentCommand(opId);

  // The device picked it up but hasn't reported a result yet — exactly the
  // "se quedó colgada" case a flaky connection produces in practice. This
  // used to be refused outright; there is nothing unsafe about canceling
  // it, since a late result is still caught by the terminal-stage guard.
  await db.runAsync(`UPDATE commands SET status = 'RUN' WHERE trans_id = ?`, [cmd.trans_id]);

  const result = await ops.cancelOperation(opId);
  assert.equal(result.ok, true);

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "canceled");

  // The device reports in anyway, late, for the now-canceled command.
  await advance.advanceOperationForCommand({
    opId,
    devId: DEV_A,
    transId: cmd.trans_id,
    cmdCode: cmd.cmd_code,
    ok: true,
    returnCode: "OK",
    resultJson: null,
    binaries: [],
  });

  const after = await ops.getOperation(opId);
  assert.equal(after?.stage, "canceled", "a late result must not reopen a manually canceled operation");
});

test("cancelOperation - refuses a command that already has a result", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncClock(DEV_A);
  const cmd = await currentCommand(opId);
  await db.runAsync(`UPDATE commands SET status = 'RESULT' WHERE trans_id = ?`, [cmd.trans_id]);

  const result = await ops.cancelOperation(opId);
  assert.equal(result.ok, false);
});

// --- Stale sweep ---

test("sweepStaleOperations - expires an operation whose device never reported", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncClock(DEV_A);
  const cmd = await currentCommand(opId);

  // Backdate as if it's been sitting untouched for a long time.
  const longAgo = Date.now() - 20 * 60 * 1000;
  await db.runAsync(`UPDATE operations SET updated_at = ? WHERE id = ?`, [longAgo, opId]);

  const expired = await advance.sweepStaleOperations();
  assert.ok(expired >= 1);

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  assert.match(op!.note ?? "", /no respondió a tiempo/);

  const command = await db.getAsync<{ status: string; cmd_return_code: string }>(
    `SELECT status, cmd_return_code FROM commands WHERE trans_id = ?`,
    [cmd.trans_id]
  );
  assert.equal(command?.status, "ERROR");
  assert.equal(command?.cmd_return_code, "TIMEOUT");
});

test("sweepStaleOperations - a resurrected stale command cannot reopen the expired operation", async () => {
  await freshDb();
  const { id: opId } = await ops.startSyncClock(DEV_A);
  const cmd = await currentCommand(opId);

  await db.runAsync(`UPDATE operations SET updated_at = ? WHERE id = ?`, [Date.now() - 20 * 60 * 1000, opId]);
  await advance.sweepStaleOperations();

  // The device reports in anyway, late, for the now-expired command.
  await advance.advanceOperationForCommand({
    opId,
    devId: DEV_A,
    transId: cmd.trans_id,
    cmdCode: cmd.cmd_code,
    ok: true,
    returnCode: "OK",
    resultJson: null,
    binaries: [],
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error", "a resurrected result must not undo the timeout");
});

test("sweepStaleOperations - a DELETE_USER verify that never answers resolves as done, not error", async () => {
  await freshDb();
  // Verified against real hardware: a GET_USER_INFO verify read for an id
  // that was actually just deleted hangs with no response at all — that's
  // DELETE_USER's own success path, not a failure, so it must not sit out
  // the full stale-sweep window nor come back as a generic "error".
  await db.runAsync(
    `INSERT INTO users (dev_id, user_id, user_name) VALUES (?, '9', 'Lenta')`,
    [DEV_A]
  );
  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // apply: device "fails" (unreliable)

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  await db.runAsync(`UPDATE operations SET updated_at = ? WHERE id = ?`, [Date.now() - 30_000, opId]);

  const expired = await advance.sweepStaleOperations();
  assert.ok(expired >= 1);

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done", "a verify timeout means the id is gone — the deletion worked");

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.equal(row, undefined, "the local cache must be cleaned up");
});

test("sweepStaleOperations - a CHANGE_PRIVILEGE verify that never answers resolves as mismatch, not error", async () => {
  await freshDb();
  const { id: opId } = await ops.startChangePrivilege(DEV_A, "3", "MANAGER");
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // apply: OK, empty body

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  await db.runAsync(`UPDATE operations SET updated_at = ? WHERE id = ?`, [Date.now() - 30_000, opId]);

  await advance.sweepStaleOperations();

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch", "an unconfirmed verify must never be reported as done");
});

function numLE(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}
