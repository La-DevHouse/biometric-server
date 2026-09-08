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

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: free
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

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: free
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

// CAPTURE_FINGERPRINT never asks which slot to capture — verified against
// real hardware (2026-09-08) that the device's backup_number is just
// registration order, not a finger identity (a right index finger landed in
// the same slot 0 previously documented as "right thumb"). It reads
// whatever the device reports and captures every fingerprint slot found.

test("CAPTURE_FINGERPRINT - captures the single fingerprint found as the canonical copy", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000001");

  const { id: opId } = await ops.startCaptureFingerprint(employeeId, DEV_A, "7");
  const template = fakeTemplate(7);
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "7",
      user_name: "ana",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [template],
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /1 huella capturada \(slot 0\)/);

  const row = await db.getAsync<{ template: Buffer; source_dev_id: string }>(
    `SELECT template, source_dev_id FROM employee_fingerprint WHERE employee_id = ? AND finger_index = 0`,
    [employeeId]
  );
  assert.ok(row, "the canonical fingerprint must be persisted");
  assert.equal(row!.source_dev_id, DEV_A);
  assert.ok(row!.template.equals(template));
});

test("CAPTURE_FINGERPRINT - captures every fingerprint slot the device reports in one shot", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000003");

  const { id: opId } = await ops.startCaptureFingerprint(employeeId, DEV_A, "7");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "7",
      user_name: "ana",
      user_privilege: "USER",
      enroll_data_array: [
        { backup_number: 0, enroll_data: "BIN_1" },
        { backup_number: 2, enroll_data: "BIN_2" },
      ],
    },
    binaries: [fakeTemplate(7), fakeTemplate(7)],
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /2 huellas capturadas \(slots 0, 2\)/);

  const rows = await db.allAsync<{ finger_index: number }>(
    `SELECT finger_index FROM employee_fingerprint WHERE employee_id = ? ORDER BY finger_index`,
    [employeeId]
  );
  assert.deepEqual(
    rows.map((r) => r.finger_index),
    [0, 2]
  );
});

test("CAPTURE_FINGERPRINT - no fingerprints registered on the device ends in error", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000002");

  const { id: opId } = await ops.startCaptureFingerprint(employeeId, DEV_A, "7");
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "7",
      user_name: "ana",
      user_privilege: "USER",
      enroll_data_array: [],
    },
  });

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  assert.match(op!.note ?? "", /no tiene huellas registradas/);

  const row = await db.getAsync(
    `SELECT 1 FROM employee_fingerprint WHERE employee_id = ?`,
    [employeeId]
  );
  assert.equal(row, undefined, "nothing should be persisted when the finger wasn't found");
});

test("startPushFingerprint - refuses when the employee has no captured fingerprint for that finger", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000003");
  await makeEnrollment(employeeId, DEV_B, "12");

  await assert.rejects(() => ops.startPushFingerprint(employeeId, 0, DEV_B), /Capturala primero/);
});

test("startPushFingerprint - refuses when there is no active enrollment on the target device", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000004");
  await db.runAsync(
    `INSERT INTO employee_fingerprint (employee_id, finger_index, template, source_dev_id, updated_at)
     VALUES (?, 0, ?, ?, now())`,
    [employeeId, fakeTemplate(7), DEV_A]
  );

  await assert.rejects(() => ops.startPushFingerprint(employeeId, 0, DEV_B), /vinculado en el equipo destino/);
});

test("PUSH_FINGERPRINT - patches the embedded user_id and verifies before finishing done", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000005");
  await makeEnrollment(employeeId, DEV_B, "12");
  await db.runAsync(
    `INSERT INTO employee_fingerprint (employee_id, finger_index, template, source_dev_id, updated_at)
     VALUES (?, 0, ?, ?, now())`,
    [employeeId, fakeTemplate(7), DEV_A]
  );

  const { id: opId, warning } = await ops.startPushFingerprint(employeeId, 0, DEV_B);
  assert.match(warning ?? "", /confirmación real es física/);

  const cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_ENROLL_DATA");
  const queued = await db.getAsync<{ cmd_binary: Buffer }>(
    `SELECT cmd_binary FROM commands WHERE trans_id = ?`,
    [cmd.trans_id]
  );
  assert.equal(queued!.cmd_binary.readUInt32LE(608), 12, "user_id at offset 608 must be patched to the target");

  // Apply: SET_ENROLL_DATA "succeeds" — not trusted on its own, see below.
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  const verifyCmd = await currentCommand(opId);
  assert.equal(verifyCmd.cmd_code, "GET_USER_INFO");

  // Verify: the target now reports a fingerprint on that finger.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "12",
      user_name: "j",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(12)],
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
});

test("PUSH_FINGERPRINT - device reports OK but the finger never shows up ends in mismatch", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V10000006");
  await makeEnrollment(employeeId, DEV_B, "12");
  await db.runAsync(
    `INSERT INTO employee_fingerprint (employee_id, finger_index, template, source_dev_id, updated_at)
     VALUES (?, 0, ?, ?, now())`,
    [employeeId, fakeTemplate(7), DEV_A]
  );

  const { id: opId } = await ops.startPushFingerprint(employeeId, 0, DEV_B);
  await completeCurrentStep(opId, { ok: true, resultJson: null });

  // Verify: the device reports OK but with no matching finger — the write
  // didn't actually apply, same untrustworthy-return-code pattern as
  // DELETE_USER.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "12", user_name: "j", user_privilege: "USER", enroll_data_array: [] },
  });
  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
});

// --- ADD_EMPLOYEE_TO_DEVICE: probe-with-retry, create, link, then push any
// already-captured fingerprints in one shot ---

test("startAddEmployeeToDevice - unknown employee is rejected before queuing anything", async () => {
  await freshDomainDb();
  await assert.rejects(
    () => ops.startAddEmployeeToDevice(DEV_B, { employeeId: 999999, userName: "Nueva" }),
    /Empleado no encontrado/
  );
});

test("startAddEmployeeToDevice - refuses when already linked to that device", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000001");
  await makeEnrollment(employeeId, DEV_B, "3");

  await assert.rejects(
    () => ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" }),
    /ya está vinculada a este equipo/
  );
});

test("startAddEmployeeToDevice - a second call while one is in flight returns the same operation", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000002");

  const first = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });
  const second = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });
  assert.equal(first.id, second.id);
});

test("ADD_EMPLOYEE_TO_DEVICE - free id on first try: creates, verifies, links, done without fingerprints", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000003");

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });

  // Probe: GET_USER_INFO fails/empty — candidate id (1, no local users yet) is free.
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_INFO");

  // Apply: not trusted on its own — verifies next, same as CREATE_USER.
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");

  // Verify: the device now confirms the new user.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Nueva", user_privilege: "USER" },
  });
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /Sin huellas capturadas todavía/);

  const enrollment = await db.getAsync<{ device_user_id: string; status: string }>(
    `SELECT device_user_id, status FROM employee_device_enrollment WHERE employee_id = ? AND dev_id = ?`,
    [employeeId, DEV_B]
  );
  assert.equal(enrollment?.device_user_id, "1");
  assert.equal(enrollment?.status, "active");
});

test("ADD_EMPLOYEE_TO_DEVICE - retries the candidate id on collision, then succeeds", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000004");

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });

  // Probe on candidate 1: taken.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Ocupado", user_privilege: "USER" },
  });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").user_id, "2", "must retry with the next candidate id");

  // Probe on candidate 2: free.
  await completeCurrentStep(opId, { ok: false, returnCode: "Error" });
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_INFO");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").user_id, "2");

  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "2", user_name: "Nueva", user_privilege: "USER" },
  });

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  const enrollment = await db.getAsync<{ device_user_id: string }>(
    `SELECT device_user_id FROM employee_device_enrollment WHERE employee_id = ? AND dev_id = ?`,
    [employeeId, DEV_B]
  );
  assert.equal(enrollment?.device_user_id, "2");
});

test("ADD_EMPLOYEE_TO_DEVICE - gives up after MAX_ID_ASSIGNMENT_ATTEMPTS collisions", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000005");

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });

  for (let i = 0; i < kinds.MAX_ID_ASSIGNMENT_ATTEMPTS; i++) {
    await completeCurrentStep(opId, {
      ok: true,
      resultJson: { user_id: String(i + 1), user_name: "Ocupado", user_privilege: "USER" },
    });
  }

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "error");
  assert.match(op!.note ?? "", /No se pudo asignar un ID automáticamente/);

  const enrollment = await db.getAsync(
    `SELECT 1 FROM employee_device_enrollment WHERE employee_id = ? AND dev_id = ?`,
    [employeeId, DEV_B]
  );
  assert.equal(enrollment, undefined, "must never link an enrollment when no id could be confirmed free");
});

test("ADD_EMPLOYEE_TO_DEVICE - copies already-captured fingerprints, tolerating one that fails to verify", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000006");
  await db.runAsync(
    `INSERT INTO employee_fingerprint (employee_id, finger_index, template, source_dev_id, updated_at)
     VALUES (?, 0, ?, ?, now())`,
    [employeeId, fakeTemplate(999), DEV_A]
  );
  await db.runAsync(
    `INSERT INTO employee_fingerprint (employee_id, finger_index, template, source_dev_id, updated_at)
     VALUES (?, 1, ?, ?, now())`,
    [employeeId, fakeTemplate(999), DEV_A]
  );

  const { id: opId, warning } = await ops.startAddEmployeeToDevice(DEV_B, { employeeId, userName: "Nueva" });
  assert.match(warning ?? "", /2 huella\(s\) capturada\(s\)/);

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply

  // Verify create: since there are pending fingers, this same step must
  // chain straight into pushing the first one (finger 0) without an extra
  // round trip waiting on user input.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Nueva", user_privilege: "USER" },
  });
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_ENROLL_DATA");
  const firstBinary = await db.getAsync<{ cmd_binary: Buffer }>(
    `SELECT cmd_binary FROM commands WHERE trans_id = ?`,
    [cmd.trans_id]
  );
  assert.equal(firstBinary!.cmd_binary.readUInt32LE(608), 1, "user_id at offset 608 patched to the new candidate");

  // Apply finger 0, then verify it landed.
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "1",
      user_name: "Nueva",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(1)],
  });

  // Chain moves on to finger 1 on its own.
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_ENROLL_DATA");

  // Apply finger 1, then verify comes back WITHOUT it (device lied about OK).
  await completeCurrentStep(opId, { ok: true, resultJson: null });
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Nueva", user_privilege: "USER", enroll_data_array: [] },
  });

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done", "at least one finger landed, so this is done, not mismatch");
  assert.match(op!.note ?? "", /1 de 2 huella\(s\) copiada\(s\)/);
  assert.match(op!.note ?? "", /Fallaron: dedo\(s\) 1/);
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

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, {
    employeeId,
    userName: "Nueva",
    privilege: "MANAGER",
  });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply

  // Verify create: the device only ever reports USER for a fingerprint-less
  // user, regardless of what was requested at creation.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Nueva", user_privilege: "USER" },
  });

  // No pending fingers -> straight to applying the privilege.
  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_PRIVILEGE");
  assert.equal(JSON.parse(cmd.cmd_param ?? "{}").user_privilege, "MANAGER");

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // apply: OK, empty body
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");
  cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "GET_USER_INFO");

  // Verify: still USER — this firmware ignores elevated privilege without a
  // fingerprint on file.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Nueva", user_privilege: "USER" },
  });

  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "mismatch");
  assert.match(op!.note ?? "", /al menos una huella registrada/);
});

test("ADD_EMPLOYEE_TO_DEVICE - MANAGER with a fingerprint pushed in the same chain ends in done", async () => {
  await freshDomainDb();
  const employeeId = await makeEmployee("V20000009");
  await db.runAsync(
    `INSERT INTO employee_fingerprint (employee_id, finger_index, template, source_dev_id, updated_at)
     VALUES (?, 0, ?, ?, now())`,
    [employeeId, fakeTemplate(999), DEV_A]
  );

  const { id: opId } = await ops.startAddEmployeeToDevice(DEV_B, {
    employeeId,
    userName: "Nueva",
    privilege: "MANAGER",
  });

  await completeCurrentStep(opId, { ok: false, returnCode: "Error" }); // probe: free
  await completeCurrentStep(opId, { ok: true, resultJson: null }); // create apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: { user_id: "1", user_name: "Nueva", user_privilege: "USER" },
  }); // verify create -> chains straight into pushing finger 0

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // push apply
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "1",
      user_name: "Nueva",
      user_privilege: "USER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(1)],
  }); // verify push -> fingerprint landed -> chains into applying the privilege

  let op = await ops.getOperation(opId);
  assert.equal(op?.stage, "waiting");
  let cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_PRIVILEGE");

  await completeCurrentStep(opId, { ok: true, resultJson: null }); // apply privilege
  op = await ops.getOperation(opId);
  assert.equal(op?.stage, "verifying");

  // Verify: now that a fingerprint exists, the device actually applies it.
  await completeCurrentStep(opId, {
    ok: true,
    resultJson: {
      user_id: "1",
      user_name: "Nueva",
      user_privilege: "MANAGER",
      enroll_data_array: [{ backup_number: 0, enroll_data: "BIN_1" }],
    },
    binaries: [fakeTemplate(1)],
  });

  op = await ops.getOperation(opId);
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

test("sweepStaleOperations - a CREATE_USER probe that never answers resolves as free, not error", async () => {
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
  assert.equal(op?.stage, "waiting", "a free id proceeds straight to SET_USER_INFO, not an error stage");
  const cmd = await currentCommand(opId);
  assert.equal(cmd.cmd_code, "SET_USER_INFO");
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

test("sweepStaleOperations - an ADD_EMPLOYEE_TO_DEVICE probe that never answers proceeds to create", async () => {
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
  assert.equal(cmd.cmd_code, "SET_USER_INFO");
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
