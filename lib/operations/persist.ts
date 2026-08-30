// Side effects shared between ad-hoc commands (handleCommandResult) and
// operation chains (advance.ts): turning a device response into rows in our
// own tables. Nothing here talks to `commands` or `operations` — that stays
// in queue.ts / advance.ts.

import { runAsync, NOW_MS } from "@/lib/db";
import { resolveBinaryRef, DecodedLogEntry } from "@/lib/protocol";

export interface UserInfoResult {
  user_id?: string;
  user_name?: string;
  user_privilege?: string;
  user_photo?: unknown;
  enroll_data_array?: Array<{ backup_number: number; enroll_data?: unknown }>;
}

/**
 * Upsert the `users` row a GET_USER_INFO result describes. Shared by the
 * ad-hoc command path and by SYNC_USERS/CHANGE_PRIVILEGE/RENAME_USER's verify
 * step, so there is exactly one implementation of "what a user record is".
 */
export async function upsertUserFromInfo(
  devId: string,
  resultJson: UserInfoResult,
  binaries: Buffer[]
): Promise<void> {
  if (!resultJson.user_id || !resultJson.user_name) return;

  // user_photo arrives as a "BIN_N" placeholder, not the actual bytes —
  // storing it as-is would persist the literal string "BIN_1" as the photo.
  const userPhoto = resolveBinaryRef(resultJson.user_photo, binaries);

  await runAsync(
    `INSERT INTO users (dev_id, user_id, user_name, user_privilege, user_photo)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(dev_id, user_id) DO UPDATE SET
       user_name = excluded.user_name,
       user_privilege = excluded.user_privilege,
       user_photo = excluded.user_photo`,
    [devId, resultJson.user_id, resultJson.user_name, resultJson.user_privilege ?? null, userPhoto]
  );

  await upsertEnrollDataFromInfo(devId, resultJson, binaries);
}

/**
 * Persist enrolled biometrics from a GET_USER_INFO result so "view
 * biometrics" is instant instead of a fresh 10-40s round trip.
 *
 * CRITICAL: an empty or absent enroll_data_array must never delete existing
 * rows. Firmware WS535BW1_BSCS_v1.5.31 reports enroll_data_array: [] for
 * several minutes after a SET_USER_INFO-triggered reindex (verified against
 * real hardware) — treating "empty" as "replace" would wipe the local
 * template archive during that window. Only upsert what actually arrives.
 */
async function upsertEnrollDataFromInfo(
  devId: string,
  resultJson: UserInfoResult,
  binaries: Buffer[]
): Promise<void> {
  const userId = resultJson.user_id;
  const entries = resultJson.enroll_data_array;
  if (!userId || !entries || entries.length === 0) return;

  for (const entry of entries) {
    const data = resolveBinaryRef(entry.enroll_data, binaries);
    if (!data) continue;
    await runAsync(
      `INSERT INTO enroll_data (dev_id, user_id, backup_number, data)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(dev_id, user_id, backup_number)
       DO UPDATE SET data = excluded.data, updated_at = ${NOW_MS}`,
      [devId, userId, entry.backup_number, data]
    );
  }
}

export interface AttendanceInsertSummary {
  total: number;
  inserted: number;
  skipped: number;
}

/**
 * Insert decoded GET_LOG_DATA records, deduplicated against whatever
 * realtime_glog already delivered.
 *
 * Natural key: (dev_id, user_id, io_time). Deliberately excludes
 * verify_mode (realtime_glog JSON-stringifies array values like "[1]" while
 * decodeLogData always emits a plain numeric string — the same physical
 * event could otherwise look like two) and io_mode (realtime sends the
 * string "0", the decoder a raw byte). The device's own 12-byte record
 * stores seconds as a single byte with no sub-second field, so it cannot
 * represent two distinct events for the same user in the same second —
 * (dev_id, user_id, io_time) is already the device's own maximum
 * resolution, verified against 64 real records with zero repeated keys.
 *
 * INSERT…SELECT…WHERE NOT EXISTS rather than INSERT OR IGNORE: works whether
 * or not the best-effort unique index (lib/db.ts) exists, and `changes`
 * gives the "N new / M already had" counts for the operation's result note
 * for free. Never overwrites, so a realtime row (which may carry log_image)
 * always wins over a synced one.
 */
export async function insertAttendanceLogs(
  devId: string,
  entries: DecodedLogEntry[]
): Promise<AttendanceInsertSummary> {
  let inserted = 0;
  for (const e of entries) {
    const { changes } = await runAsync(
      `INSERT INTO attendance_logs (dev_id, user_id, verify_mode, io_mode, io_time)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM attendance_logs
          WHERE dev_id = ? AND user_id = ? AND io_time = ?
       )`,
      [devId, e.user_id, e.verify_mode, e.io_mode, e.io_time, devId, e.user_id, e.io_time]
    );
    inserted += changes;
  }
  return { total: entries.length, inserted, skipped: entries.length - inserted };
}

export interface DeviceStatusResult {
  total_user_count?: string | number;
  totalUserCount?: string | number;
  manager_count?: string | number;
  managerCount?: string | number;
  fp_count?: string | number;
  fpCount?: string | number;
  total_log_count?: string | number;
  totalLogCount?: string | number;
}

function toIntOrNull(value: string | number | undefined): number | null {
  if (value === undefined) return null;
  const n = typeof value === "number" ? value : parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Cache a GET_DEVICE_STATUS snapshot on the `devices` row so the dashboard
 * can show it without a live round trip. Accepts both the real firmware's
 * snake_case string fields (`"fp_count":"3"`) and the simulator's camelCase
 * numeric fields (`fpCount:6`).
 */
export async function upsertDeviceStatus(
  devId: string,
  resultJson: DeviceStatusResult
): Promise<void> {
  const userCount = toIntOrNull(resultJson.total_user_count ?? resultJson.totalUserCount);
  const managerCount = toIntOrNull(resultJson.manager_count ?? resultJson.managerCount);
  const fpCount = toIntOrNull(resultJson.fp_count ?? resultJson.fpCount);
  const logCount = toIntOrNull(resultJson.total_log_count ?? resultJson.totalLogCount);

  await runAsync(
    `UPDATE devices
        SET stat_user_count = ?, stat_manager_count = ?, stat_fp_count = ?,
            stat_log_count = ?, stat_updated_at = ${NOW_MS}
      WHERE dev_id = ?`,
    [userCount, managerCount, fpCount, logCount, devId]
  );
}
