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
const kinds = require("../lib/operations/kinds") as typeof import("../lib/operations/kinds");
const fingerprints = require("../lib/fingerprints") as typeof import("../lib/fingerprints");

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

/**
 * A GET_USER_ID_LIST result listing `ids` (the device's framing: 8-byte
 * records, first 4 bytes = user_id LE). Since O9 (docs/10 §8) a probe that
 * gets no answer cross-checks this list before creating anything.
 */
function idListResult(ids: number[]) {
  return {
    ok: true,
    resultJson: { user_id_count: ids.length, one_user_id_size: 8, user_id_array: "BIN_1" },
    binaries: [Buffer.concat(ids.map((n) => Buffer.concat([numLE(n), Buffer.from([1, 1, 8, 0])])))],
  };
}

/** GET_DEVICE_STATUS result with the given total_user_count (strings, like the device). */
function statusResult(totalUsers: number) {
  return { ok: true, resultJson: { total_user_count: String(totalUsers), fp_count: "0" } };
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
//
// "OPERATOR"/"REGISTER" used to be offered here too, but both are verified
// against real hardware (2026-09-08, device 2023081133) to do nothing —
// cmd_return_code:OK, device stays on USER regardless. Privilege no longer
// even types them. The mismatch path itself is still real, though: verified
// the same day that even "MANAGER" silently fails to apply while the user
// has no fingerprint registered yet (docs/05-commands-catalog.md →
// SET_USER_PRIVILEGE) — that's the scenario exercised below instead.

test("CHANGE_PRIVILEGE - MANAGER that the device silently ignores (no fingerprint yet) ends in mismatch", async () => {
  await freshDb();
  const { id: opId } = await ops.startChangePrivilege(DEV_A, "3", "MANAGER");

  // Apply step: SET_USER_PRIVILEGE often returns OK with an empty body.
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");

  // Verify step: the device kept USER — verified real cause is "no
  // fingerprint registered on this user yet", not a firmware quirk specific
  // to any one privilege string.
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

  // Probe: GET_USER_INFO fails/empty — not enough on its own (O9)...
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_ID_LIST", "a silent probe must be cross-checked before creating");
  // ...the id is not among the users with fingerprints — free to create.
  await completeCurrentStep(opId, idListResult([1, 2]));

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  cmd = await currentCommand(opId);
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

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: no answer
  await completeCurrentStep(opId, idListResult([])); // cross-check: not listed → free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // SET_USER_INFO "succeeds"

  // Verify: GET_USER_INFO still finds nothing.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /No se pudo verificar la creación/);

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.equal(row, undefined, "must not be cached locally when it was never verified on the device");
});

// CREATE_USER's own SET_USER_INFO never actually applies an elevated
// privilege at creation time (verified against real hardware, 2026-09-08) —
// this is requested as a separate SET_USER_PRIVILEGE AFTER the user is
// confirmed to exist, same reasoning as ADD_EMPLOYEE_TO_DEVICE below.

test("CREATE_USER - MANAGER without a fingerprint ends in mismatch with a clear reason", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, {
    userId: "9",
    userName: "nueva",
    privilege: "MANAGER",
  });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: no answer
  await completeCurrentStep(opId, idListResult([])); // cross-check: not listed → free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply

  // Verify create: the device only ever reports USER for a fingerprint-less
  // user, regardless of what was requested at creation.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "9", user_name: "nueva", user_privilege: "USER" },
  });

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_PRIVILEGE");

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // apply: OK, empty body
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");

  // Verify: still USER — no fingerprint on file, so this firmware ignores it.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "9", user_name: "nueva", user_privilege: "USER" },
  });

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /al menos una huella registrada/);

  const row = await db.getAsync<{ user_privilege: string }>(
    `SELECT user_privilege FROM users WHERE dev_id = ? AND user_id = '9'`,
    [DEV_A]
  );
  assert.equal(row?.user_privilege, "USER", "the local cache reflects what the device actually confirmed");
});

test("CREATE_USER - MANAGER that verifies (fingerprint already on file) ends in done", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, {
    userId: "9",
    userName: "nueva",
    privilege: "MANAGER",
  });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: no answer
  await completeCurrentStep(opId, idListResult([])); // cross-check: not listed → free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "9", user_name: "nueva", user_privilege: "USER" },
  }); // verify create -> chains into applying the privilege

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // apply privilege
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "9", user_name: "nueva", user_privilege: "MANAGER" },
  }); // verify privilege -> applied

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /privilegio "MANAGER" \(verificado en el dispositivo\)/);
});

// --- DELETE_USER: apply's return code is untrustworthy; the user count decides ---
//
// Neither DELETE_USER's return code nor GET_USER_INFO can verify a deletion:
// the former lies in both directions, and the latter also hangs,
// intermittently, for ids that DO exist (docs/10 §8 O9 — it reported a
// failed deletion as "verified" on 2023081133, 2026-09-26). The operation
// brackets the delete with GET_DEVICE_STATUS: total_user_count must drop by 1.

async function seedUser9() {
  await db.runAsync(
    `INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, '9', 'zed', 'USER')`,
    [DEV_A]
  );
}

test("DELETE_USER - device reports Error but the count drops by one ends in done", async () => {
  await freshDb();
  await seedUser9();
  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");

  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_DEVICE_STATUS", "must read the baseline count before deleting");
  await completeCurrentStep(opId, statusResult(6));

  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "DELETE_USER");
  // Apply: verified against real hardware that DELETE_USER can report
  // cmd_return_code "Error" for a deletion that actually succeeded.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_DEVICE_STATUS");

  await completeCurrentStep(opId, statusResult(5));
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /verificado/);

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.equal(row, undefined, "the local cache row must be cleaned up on a verified deletion");
});

test("DELETE_USER - device reports Error and the count does not change ends in mismatch (the 30000001 case)", async () => {
  await freshDb();
  await seedUser9();
  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");

  await completeCurrentStep(opId, statusResult(7));
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  await completeCurrentStep(opId, statusResult(7));

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /sigue existiendo/);

  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.ok(row, "the local cache must not be touched when deletion did not verify");
});

test("DELETE_USER - a count that moves by more than one is not claimed as done", async () => {
  await freshDb();
  await seedUser9();
  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");

  await completeCurrentStep(opId, statusResult(7));
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, statusResult(5));

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /de 7 a 5/);
});

test("DELETE_USER - an unreadable baseline aborts before anything destructive is sent", async () => {
  await freshDb();
  await seedUser9();
  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  const commands = await ops.getOperationCommands(opId);
  assert.ok(!commands.some((c) => c.cmd_code === "DELETE_USER"), "DELETE_USER must never be sent without a baseline");
});

// --- Probe cross-check (O9): a silent GET_USER_INFO is not "free" by itself ---

test("CREATE_USER - silent probe but the id IS listed (has fingerprints): refuses, never sends SET_USER_INFO", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "9", userName: "nueva" });

  await completeCurrentStep(opId, { ok: false, returnCode: "TIMEOUT" }); // probe hangs on an existing id
  await completeCurrentStep(opId, idListResult([2, 9]));

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  assert.match(op!.note ?? "", /ya existe en el equipo con huellas/);
  const commands = await ops.getOperationCommands(opId);
  assert.ok(!commands.some((c) => c.cmd_code === "SET_USER_INFO"), "must never create over a user with fingerprints");
});

test("CREATE_USER - silent probe and the id list cannot be read: refuses rather than guessing", async () => {
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "9", userName: "nueva" });

  await completeCurrentStep(opId, { ok: false, returnCode: "TIMEOUT" });
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  const commands = await ops.getOperationCommands(opId);
  assert.ok(!commands.some((c) => c.cmd_code === "SET_USER_INFO"));
});

// --- Fingerprint migration: CAPTURE_FINGERPRINT / PUSH_FINGERPRINT ---
// Recipe verified against real hardware (docs/05-commands-catalog.md,
// "Migración de huellas entre dispositivos"): read with GET_USER_INFO (the
// clean 612-byte form), patch the embedded user_id at offset 608, write with
// SET_ENROLL_DATA on a device where the person already has a user.

const DEV_B = "TEST_DEV_B";

/** A stand-in for the real 612-byte template, with a real-looking user_id
 * baked in at offset 608 the same way the device does. */
function fakeTemplate(embeddedUserId: number): Buffer {
  const buf = Buffer.alloc(612, 0xaa);
  buf.writeUInt32LE(embeddedUserId, 608);
  return buf;
}

async function freshDomainDb() {
  await freshDb();
  // device_fingerprint_slot / sync_run / sync_hold se van en cascada con devices (freshDb).
  await db.execAsync(
    `DELETE FROM employee_fingerprint; DELETE FROM employee_device_enrollment; DELETE FROM employee;`
  );
  await db.runAsync(`INSERT INTO devices (dev_id, last_seen_at) VALUES (?, ${db.NOW_MS})`, [DEV_B]);
}

async function makeEmployee(nationalId: string): Promise<number> {
  const row = await db.getAsync<{ id: number }>(
    `INSERT INTO employee (national_id, first_name, last_name, updated_at)
     VALUES (?, 'Test', 'Person', now()) RETURNING id`,
    [nationalId]
  );
  return row!.id;
}

async function makeEnrollment(employeeId: number, devId: string, deviceUserId: string): Promise<void> {
  await db.runAsync(
    `INSERT INTO employee_device_enrollment (employee_id, dev_id, device_user_id, status, updated_at)
     VALUES (?, ?, ?, 'active', now())`,
    [employeeId, devId, deviceUserId]
  );
}

async function makeFingerprint(employeeId: number, template: Buffer, sourceBackupNumber = 0): Promise<number> {
  const row = await db.getAsync<{ id: number }>(
    `INSERT INTO employee_fingerprint (employee_id, source_backup_number, template, source_dev_id, updated_at)
     VALUES (?, ?, ?, ?, now()) RETURNING id`,
    [employeeId, sourceBackupNumber, template, DEV_A]
  );
  return row!.id;
}

async function slotsOf(devId: string, userId: string) {
  return db.allAsync<{ backup_number: number; origin: string; fingerprint_id: number | null }>(
    `SELECT backup_number, origin, fingerprint_id FROM device_fingerprint_slot
      WHERE dev_id = ? AND device_user_id = ? ORDER BY backup_number`,
    [devId, userId]
  );
}

// --- CAPTURE_FINGERPRINT / ingesta (lib/fingerprints.ts, docs/10 R9) ---
// Nunca pide elegir slot: el backup_number es orden de registro del equipo,
// no identidad de dedo (verificado contra hardware real, 2026-09-08). Lo que
// el equipo reporta y el registro de procedencia no conoce = huella física
// nueva; lo ya conocido no se duplica.

test("CAPTURE_FINGERPRINT - a new physical fingerprint becomes a canonical copy + a physical slot", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000001");

  const { id: opId } = await ops.startCaptureFingerprint(employeeId, DEV_A, "10000001");
  const template = fakeTemplate(10000001);
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "10000001",
      user_name: "ana",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [template],
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /1 huella\(s\) nueva\(s\)/);

  const row = await db.getAsync<{ template: Buffer; source_dev_id: string; source_backup_number: number }>(
    `SELECT template, source_dev_id, source_backup_number FROM employee_fingerprint WHERE employee_id = ?`,
    [employeeId]
  );
  assert.ok(row!.template.equals(template));
  assert.equal(row!.source_dev_id, DEV_A);
  assert.equal(row!.source_backup_number, 0);
  assert.deepEqual(
    (await slotsOf(DEV_A, "10000001")).map((x) => [x.backup_number, x.origin]),
    [[0, "physical"]]
  );
  const link = await db.getAsync(`SELECT 1 FROM employee_device_enrollment WHERE employee_id = ? AND dev_id = ?`, [employeeId, DEV_A]);
  assert.ok(link, "the cédula links the device user to the employee automatically");
});

test("CAPTURE_FINGERPRINT - capturing the same device twice does not duplicate anything", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000003");
  const info = {
    ok: true,
    resultJson: {
      user_id: "10000003",
      user_name: "ana",
      user_privilege: "USER",
      enroll_data_array: [
        { backup_number: 0, enroll_data: "BIN_1" },
        { backup_number: 2, enroll_data: "BIN_2" },
      ],
    },
    binaries: [fakeTemplate(10000003), fakeTemplate(10000003)],
  };

  const first = await ops.startCaptureFingerprint(employeeId, DEV_A, "10000003");
  await completeCurrentStep(first.id, info);
  const second = await ops.startCaptureFingerprint(employeeId, DEV_A, "10000003");
  await completeCurrentStep(second.id, info);

  const count = await db.getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM employee_fingerprint WHERE employee_id = ?`, [employeeId]);
  assert.equal(count!.n, 2);
  assert.match((await ops.getOperation(second.id))!.note ?? "", /Sin huellas nuevas/);
});

test("CAPTURE_FINGERPRINT - no fingerprints registered on the device ends in error", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000002");

  const { id: opId } = await ops.startCaptureFingerprint(employeeId, DEV_A, "10000002");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "10000002", user_name: "ana", user_privilege: "USER", enroll_data_array: [] },
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  assert.match(op!.note ?? "", /no tiene huellas registradas/);
});

test("CAPTURE_FINGERPRINT - a device user id that is no employee's cédula is not ingested", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000009");

  const { id: opId } = await ops.startCaptureFingerprint(employeeId, DEV_A, "7");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "7", user_name: "x", user_privilege: "USER", enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }] },
    binaries: [fakeTemplate(7)],
  });

  assert.equal((await ops.getOperation(opId))?.stage, "error");
  const row = await db.getAsync(`SELECT 1 FROM employee_fingerprint WHERE employee_id = ?`, [employeeId]);
  assert.equal(row, undefined);
});

test("ingestUserInfo - a slot we propagated is never re-ingested as a new fingerprint (no ping-pong)", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000011");
  const fpId = await makeFingerprint(employeeId, fakeTemplate(1));
  await fingerprints.recordPropagatedSlot(DEV_B, "10000011", 3, fpId);

  // DEV_B reports that slot (the device refined the template, so the bytes
  // differ — docs/05): still the same copy, per the provenance registry.
  const result = await fingerprints.ingestUserInfo(
    DEV_B,
    { user_id: "10000011", enroll_data_array: [{ backup_number: 3, enroll_data: "BIN_1" }] },
    [fakeTemplate(10000011)]
  );
  assert.deepEqual(result.newFingerprintIds, []);
  const count = await db.getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM employee_fingerprint WHERE employee_id = ?`, [employeeId]);
  assert.equal(count!.n, 1);
});

test("freeSlot - first unused slot 0–9, or null when all ten are taken", () => {
  assert.equal(fingerprints.freeSlot([]), 0);
  assert.equal(fingerprints.freeSlot([0, 1, 3]), 2);
  assert.equal(fingerprints.freeSlot([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), null);
});

// --- PUSH_FINGERPRINT: always into a FREE slot (an occupied one silently
// ignores the write — docs/05, T9b), verified by re-reading ---

test("startPushFingerprint - refuses a fingerprint that isn't this person's", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000013");
  await makeEnrollment(employeeId, DEV_B, "10000013");
  await assert.rejects(() => ops.startPushFingerprint(employeeId, 999999, DEV_B), /no existe o no es de esta persona/);
});

test("startPushFingerprint - refuses when there is no active enrollment on the target device", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000004");
  const fpId = await makeFingerprint(employeeId, fakeTemplate(7));
  await assert.rejects(() => ops.startPushFingerprint(employeeId, fpId, DEV_B), /vinculado en el equipo destino/);
});

test("PUSH_FINGERPRINT - writes to the first free slot, patches the user_id, verifies, records a propagated slot", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000005");
  await makeEnrollment(employeeId, DEV_B, "10000005");
  const other = await makeFingerprint(employeeId, fakeTemplate(7), 0);
  await fingerprints.recordPropagatedSlot(DEV_B, "10000005", 0, other); // slot 0 taken
  const fpId = await makeFingerprint(employeeId, fakeTemplate(7), 1);

  const { id: opId, warning } = await ops.startPushFingerprint(employeeId, fpId, DEV_B);
  assert.match(warning ?? "", /confirmación real es física/);

  const cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_ENROLL_DATA");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").backup_number, 1, "slot 0 is occupied → slot 1");
  const queued = await db.getAsync<{ cmd_binary: Buffer }>(`SELECT cmd_binary FROM commands WHERE trans_id = ?`, [cmd.trans_id]);
  assert.equal(queued!.cmd_binary.readUInt32LE(608), 10000005, "user_id at offset 608 patched to the target");

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // apply: not trusted
  assert.equal((await ops.getOperation(opId))?.stage, "verifying");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "10000005",
      user_name: "j",
      user_privilege: "USER",
      enroll_data_array: [
        { backup_number: 0, enroll_data: "BIN_1" },
        { backup_number: 1, enroll_data: "BIN_2" },
      ],
    },
    binaries: [fakeTemplate(10000005), fakeTemplate(10000005)],
  });
  assert.equal((await ops.getOperation(opId))?.stage, "done");
  const slots = await slotsOf(DEV_B, "10000005");
  assert.deepEqual(
    slots.map((x) => [x.backup_number, x.origin, x.fingerprint_id]),
    [
      [0, "propagated", other],
      [1, "propagated", fpId],
    ]
  );
});

test("PUSH_FINGERPRINT - device reports OK but the slot stays empty ends in mismatch, no slot recorded", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000006");
  await makeEnrollment(employeeId, DEV_B, "10000006");
  const fpId = await makeFingerprint(employeeId, fakeTemplate(7));

  const { id: opId } = await ops.startPushFingerprint(employeeId, fpId, DEV_B);
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "10000006", user_name: "j", user_privilege: "USER", enroll_data_array: [] },
  });
  assert.equal((await ops.getOperation(opId))?.stage, "mismatch");
  assert.deepEqual(await slotsOf(DEV_B, "10000006"), []);
});

// --- ADD_EMPLOYEE_TO_DEVICE: probe, create (or link the existing cédula),
// then push the "first 10" canonical copies into free slots ---

test("startAddEmployeeToDevice - unknown employee is rejected before queuing anything", async () => {
  await freshDomainDb();
  await assert.rejects(
    () => ops.startAddEmployeeToDevice(DEV_B, { employeeId: 999999, userName: "Nueva" }),
    /Empleado no encontrado/
  );
});

test("startAddEmployeeToDevice - manual start refuses when already linked; background (reconciler) allows it", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000001");
  await makeEnrollment(employeeId, DEV_B, "20000001");

  await assert.rejects(
    () => ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" }),
    /ya está vinculada a este equipo/
  );
  const bg = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" }, { background: true });
  const row = await db.getAsync<{ priority: number }>(`SELECT priority FROM operations WHERE id = ?`, [bg.id]);
  assert.equal(row!.priority, 200, "reconciler work runs at background priority");
});

test("startAddEmployeeToDevice - a second call while one is in flight returns the same operation", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000002");

  const first = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });
  const second = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });
  assert.equal(first.id, second.id);
});

test("ADD_EMPLOYEE_TO_DEVICE - uses the employee's cédula (digits only) as the device id", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000003");

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });

  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").user_id, "20000003", "id must be the cédula, not a sequential number");
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  await completeCurrentStep(opId, idListResult([1])); // cross-check: not listed → free

  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_INFO");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").user_id, "20000003");

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  assert.equal((await ops.getOperation(opId))?.stage, "verifying");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "20000003", user_name: "Nueva", user_privilege: "USER" },
  });
  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /Sin huellas capturadas todavía/);

  const enrollment = await db.getAsync<{ device_user_id: string; status: string }>(
    `SELECT device_user_id, status FROM employee_device_enrollment WHERE employee_id = ? AND dev_id = ?`,
    [employeeId, DEV_B]
  );
  assert.equal(enrollment?.device_user_id, "20000003");
  assert.equal(enrollment?.status, "active");
});

test("ADD_EMPLOYEE_TO_DEVICE - the cédula already exists on the device: links it by cédula, never SET_USER_INFO, keeps its fingerprints", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000004");

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });

  // Probe: the device already has this cédula, with its own physical fingerprint.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "20000004",
      user_name: "Nombre Viejo",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(20000004)],
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /ya existía en el equipo \("Nombre Viejo"\): vinculado por cédula/);
  const commands = await ops.getOperationCommands(opId);
  assert.ok(!commands.some((c) => c.cmd_code === "SET_USER_INFO"), "must never SET_USER_INFO over an existing user");
  const link = await db.getAsync(`SELECT 1 FROM employee_device_enrollment WHERE employee_id = ? AND dev_id = ? AND status = 'active'`, [employeeId, DEV_B]);
  assert.ok(link);
  assert.deepEqual((await slotsOf(DEV_B, "20000004")).map((x) => x.origin), ["physical"], "its own fingerprint was ingested, not overwritten");
});

test("ADD_EMPLOYEE_TO_DEVICE - copies the canonical fingerprints into free slots, tolerating one that fails to verify", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000006");
  await makeFingerprint(employeeId, fakeTemplate(999), 0);
  await makeFingerprint(employeeId, fakeTemplate(999), 0);

  const { id: opId, warning } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });
  assert.match(warning ?? "", /2 huella\(s\) capturada\(s\)/);

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: no answer
  await completeCurrentStep(opId, idListResult([])); // cross-check: not listed → free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "20000006", user_name: "Nueva", user_privilege: "USER" },
  }); // verify create → chains into the first push

  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_ENROLL_DATA");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").backup_number, 0);
  const firstBinary = await db.getAsync<{ cmd_binary: Buffer }>(`SELECT cmd_binary FROM commands WHERE trans_id = ?`, [cmd.trans_id]);
  assert.equal(firstBinary!.cmd_binary.readUInt32LE(608), 20000006, "user_id at offset 608 patched to the cédula");

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "20000006",
      user_name: "Nueva",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(20000006)],
  });

  // Second copy goes to the next free slot (1).
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_ENROLL_DATA");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").backup_number, 1);
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "20000006",
      user_name: "Nueva",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(20000006)],
  }); // device "OK" but slot 1 never showed up

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done", "at least one landed, so this is done, not mismatch");
  assert.match(op!.note ?? "", /1 de 2 huella\(s\) copiada\(s\)/);
  assert.match(op!.note ?? "", /no reportada en el slot 1/);
  assert.deepEqual((await slotsOf(DEV_B, "20000006")).map((x) => [x.backup_number, x.origin]), [[0, "propagated"]]);
});

// --- ADD_EMPLOYEE_TO_DEVICE: elevated privilege only applies once the user
// has a fingerprint, so it's requested LAST, after any fingerprint push ---
// Verified against real hardware (2026-09-08): a brand-new user created with
// SET_USER_INFO's user_privilege:"MANAGER" was reported back as "USER", and
// a follow-up SET_USER_PRIVILEGE("MANAGER") on that same still-fingerprint-
// less user also silently failed (device answered OK, stayed "USER") —
// applying only once a fingerprint existed on the device.

test("ADD_EMPLOYEE_TO_DEVICE - MANAGER without any fingerprint ends in mismatch with a clear reason", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000008");

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva", privilege: "MANAGER" });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: no answer
  await completeCurrentStep(opId, idListResult([])); // cross-check: not listed → free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "20000008", user_name: "Nueva", user_privilege: "USER" },
  });

  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_PRIVILEGE");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").user_privilege, "MANAGER");

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "20000008", user_name: "Nueva", user_privilege: "USER" },
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /al menos una huella registrada/);
});

test("ADD_EMPLOYEE_TO_DEVICE - MANAGER with a fingerprint pushed in the same chain ends in done", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000009");
  await makeFingerprint(employeeId, fakeTemplate(999));

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva", privilege: "MANAGER" });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: no answer
  await completeCurrentStep(opId, idListResult([])); // cross-check: not listed → free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "20000009", user_name: "Nueva", user_privilege: "USER" },
  }); // verify create → push

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // push apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "20000009",
      user_name: "Nueva",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(20000009)],
  }); // verify push → privilege

  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_PRIVILEGE");
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  assert.equal((await ops.getOperation(opId))?.stage, "verifying");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "20000009",
      user_name: "Nueva",
      user_privilege: "MANAGER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(20000009)],
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /Privilegio "MANAGER" verificado en el dispositivo/);
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

test("sweepStaleOperations - a DELETE_USER verify that never answers resolves as mismatch, never done", async () => {
  await freshDb();
  // Silence used to count as DELETE_USER's success path. It must not: on
  // real hardware GET_USER_INFO also hangs for ids that still exist (O9),
  // and an unanswered verify proves nothing either way.
  await db.runAsync(`INSERT INTO users (dev_id, user_id, user_name) VALUES (?, '9', 'Lenta')`, [DEV_A]);
  const { id: opId } = await ops.startDeleteUser(DEV_A, "9");
  await completeCurrentStep(opId, statusResult(6)); // baseline
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // apply (unreliable)

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  await db.runAsync(`UPDATE operations SET updated_at = ? WHERE id = ?`, [Date.now() - 30_000, opId]);

  const expired = await advance.sweepStaleOperations();
  assert.ok(expired >= 1);

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch", "an unanswered verify can't confirm the deletion");
  const row = await db.getAsync(`SELECT 1 FROM users WHERE dev_id = ? AND user_id = '9'`, [DEV_A]);
  assert.ok(row, "the local cache must stay until a deletion is actually confirmed");
});

test("sweepStaleOperations - a CREATE_USER probe that never answers moves on to the id-list cross-check", async () => {
  // Verified against real hardware (device 2023081133, 2026-08-18): probing
  // a genuinely new id with GET_USER_INFO hangs forever once delivered — the
  // device never sends a result — while an id that exists always answers in
  // seconds. Before this fix, that silence fell through to a generic
  // timeout error instead of being read as "the id is free", which is the
  // whole point of the probe.
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "9", userName: "nueva" });

  // Simulate the device having actually picked up the probe command
  // (protocol-handlers.ts flips queued/waiting -> sent on delivery; this
  // unit harness doesn't run that handler, so it's done directly here).
  // 31s, not minutes: a probe's own timeout is short (PROBE_TIMEOUT_MS,
  // 30s) since an id that exists always answers within seconds — this
  // pins that it's actually that short, not the generic 3-minute 'sent'
  // timeout other operation kinds use.
  await db.runAsync(`UPDATE operations SET stage = 'sent', updated_at = ? WHERE id = ?`, [
    Date.now() - 31_000,
    opId,
  ]);
  const expired = await advance.sweepStaleOperations();
  assert.ok(expired >= 1);

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting", "a silent probe moves on to the id-list cross-check, not an error stage");
  const cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_ID_LIST");
});

test("sweepStaleOperations - a CREATE_USER probe still queued (device never polled) times out as a plain error", async () => {
  // The hang-means-free signal only applies once the probe was actually
  // delivered (stage 'sent') — a command still sitting 'queued' for an
  // offline device carries no such signal and must not be misread as "free".
  await freshDb();
  const { id: opId } = await ops.startCreateUser(DEV_A, { userId: "9", userName: "nueva" });
  await db.runAsync(`UPDATE commands SET status = 'WAIT' WHERE op_id = ?`, [opId]);
  await db.runAsync(`UPDATE operations SET stage = 'queued', updated_at = ? WHERE id = ?`, [
    Date.now() - 11 * 60 * 1000,
    opId,
  ]);

  await advance.sweepStaleOperations();

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error", "an undelivered probe must use the generic offline-device timeout, not 'free'");
});

test("sweepStaleOperations - an ADD_EMPLOYEE_TO_DEVICE probe that never answers moves on to the id-list cross-check", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000007");
  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });

  await db.runAsync(`UPDATE operations SET stage = 'sent', updated_at = ? WHERE id = ?`, [
    Date.now() - 31_000,
    opId,
  ]);
  await advance.sweepStaleOperations();

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  const cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_ID_LIST");
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
