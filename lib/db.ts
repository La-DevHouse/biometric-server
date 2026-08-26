import sqlite3 from "sqlite3";
import { existsSync, mkdirSync } from "fs";
import path from "path";

const dbDir = path.join(process.cwd(), "data");
const dbPath = process.env.BIOMETRIC_DB_PATH || path.join(dbDir, "biometric.db");

// Ensure data directory exists (skip for the in-memory test path)
if (dbPath !== ":memory:" && !existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

let db: sqlite3.Database;

// initDb() used to open a fresh sqlite3.Database and reassign the module
// singleton on every call — every page render and every server action. That
// leaked connections and raced: one request's `db` could be swapped out by
// another's mid-query. Memoizing makes initDb() idempotent for the life of
// the process; resetting on failure keeps one transient error from
// permanently poisoning it.
let initPromise: Promise<void> | null = null;

export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = openAndMigrate().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

function openAndMigrate(): Promise<void> {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        reject(err);
        return;
      }
      migrate().then(resolve).catch(reject);
    });
  });
}

async function migrate(): Promise<void> {
  await execAsync(BASE_SCHEMA_SQL);

  // ALTER TABLE is not idempotent (SQLite errors on a duplicate column), so it
  // can't live inside the multi-statement exec above — a second run would
  // abort the whole migration. Each addition is its own guarded step.
  await addColumnIfMissing("commands", "op_id", "op_id INTEGER");
  await addColumnIfMissing("devices", "stat_user_count", "stat_user_count INTEGER");
  await addColumnIfMissing("devices", "stat_manager_count", "stat_manager_count INTEGER");
  await addColumnIfMissing("devices", "stat_fp_count", "stat_fp_count INTEGER");
  await addColumnIfMissing("devices", "stat_log_count", "stat_log_count INTEGER");
  await addColumnIfMissing("devices", "stat_updated_at", "stat_updated_at INTEGER");

  await execAsync(`
    CREATE INDEX IF NOT EXISTS idx_commands_op_id ON commands(op_id);
    CREATE INDEX IF NOT EXISTS idx_attendance_natural
      ON attendance_logs(dev_id, user_id, io_time);
  `);

  await tryHardenAttendanceUniqueness();
}

async function addColumnIfMissing(
  table: string,
  column: string,
  ddl: string
): Promise<void> {
  const cols = await allAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (cols.some((c) => c.name === column)) return;
  await execAsync(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

// Correctness never depends on this index — app-level dedup (see
// lib/operations/persist.ts) handles duplicates unconditionally. This is a
// best-effort hardening pass: if the table already has duplicate
// (dev_id, user_id, io_time) groups (possible on a database that predates the
// dedup logic), creating a UNIQUE index would fail. Rather than let that
// reject initDb() and take the whole server down, warn and move on — the
// cleanup is a deliberate, opt-in step (scripts/dedupe-attendance.ts), never
// something that happens silently inside a migration.
async function tryHardenAttendanceUniqueness(): Promise<void> {
  try {
    const dupes = await getAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM (
         SELECT 1 FROM attendance_logs
         GROUP BY dev_id, user_id, io_time HAVING COUNT(*) > 1
       )`
    );
    if ((dupes?.n ?? 0) > 0) {
      console.warn(
        `[db] attendance_logs tiene ${dupes!.n} grupo(s) de marcaciones duplicadas; ` +
          `no se creará el índice único. La deduplicación a nivel de aplicación sigue ` +
          `activa igualmente. Ejecuta "npx tsx scripts/dedupe-attendance.ts" para limpiarlas.`
      );
      return;
    }
    await execAsync(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_attendance_natural
         ON attendance_logs(dev_id, user_id, io_time)`
    );
  } catch (err) {
    console.warn("[db] no se pudo crear el índice único de asistencia:", err);
  }
}

const BASE_SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS devices (
      dev_id TEXT PRIMARY KEY,
      fk_name TEXT,
      firmware TEXT,
      fk_bin_data_lib TEXT,
      supported_enroll_data TEXT,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );

    CREATE TABLE IF NOT EXISTS commands (
      trans_id INTEGER PRIMARY KEY AUTOINCREMENT,
      dev_id TEXT NOT NULL,
      cmd_code TEXT NOT NULL,
      cmd_param TEXT,
      cmd_binary BLOB,
      status TEXT NOT NULL DEFAULT 'WAIT' CHECK (status IN ('WAIT', 'RUN', 'RESULT', 'ERROR')),
      result_json TEXT,
      result_binary BLOB,
      cmd_return_code TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (dev_id) REFERENCES devices(dev_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dev_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      verify_mode TEXT,
      io_mode INTEGER,
      io_time TEXT,
      log_image BLOB,
      received_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      FOREIGN KEY (dev_id) REFERENCES devices(dev_id)
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dev_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT,
      user_privilege TEXT,
      user_photo BLOB,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      UNIQUE(dev_id, user_id),
      FOREIGN KEY (dev_id) REFERENCES devices(dev_id)
    );

    CREATE TABLE IF NOT EXISTS enroll_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dev_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      backup_number INTEGER NOT NULL,
      data BLOB NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      UNIQUE(dev_id, user_id, backup_number),
      FOREIGN KEY (dev_id) REFERENCES devices(dev_id)
    );

    CREATE TABLE IF NOT EXISTS block_buffer (
      dev_id TEXT NOT NULL,
      trans_id INTEGER NOT NULL,
      blk_no INTEGER NOT NULL,
      data BLOB NOT NULL,
      received_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      PRIMARY KEY (dev_id, trans_id, blk_no),
      FOREIGN KEY (dev_id) REFERENCES devices(dev_id),
      FOREIGN KEY (trans_id) REFERENCES commands(trans_id)
    );

    CREATE TABLE IF NOT EXISTS raw_traffic (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
      dev_id TEXT,
      request_code TEXT,
      headers_json TEXT,
      body_preview TEXT,
      body_size INTEGER,
      binary_size INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000)
    );

    -- One row per high-level dashboard action (e.g. "change privilege"), which
    -- orchestrates one or more low-level commands. See lib/operations/.
    CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      dev_id TEXT NOT NULL,
      user_id TEXT,
      params_json TEXT,
      stage TEXT NOT NULL DEFAULT 'queued'
        CHECK (stage IN ('queued','sent','waiting','verifying',
                          'done','mismatch','error','canceled')),
      step_index INTEGER NOT NULL DEFAULT 0,
      step_total INTEGER NOT NULL DEFAULT 1,
      plan_json TEXT,
      current_trans_id INTEGER,
      last_trans_id INTEGER,
      result_note TEXT,
      error_note TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch('now') * 1000),
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_commands_dev_id_status ON commands(dev_id, status);
    CREATE INDEX IF NOT EXISTS idx_attendance_logs_dev_id ON attendance_logs(dev_id);
    CREATE INDEX IF NOT EXISTS idx_users_dev_id ON users(dev_id);
    CREATE INDEX IF NOT EXISTS idx_raw_traffic_created_at ON raw_traffic(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operations_dev_stage ON operations(dev_id, stage);
    CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at DESC);
  `;

export interface RunResult {
  /** rowid inserted by this statement; 0 for a non-INSERT. */
  lastID: number;
  /** rows affected by INSERT/UPDATE/DELETE; 0 otherwise. */
  changes: number;
}

export function runAsync(sql: string, params: any[] = []): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Must be a `function` callback, not an arrow: node-sqlite3 exposes
    // lastID/changes on the callback's `this`, which an arrow would not
    // capture (it would silently be undefined).
    db.run(sql, params, function (this: sqlite3.RunResult, err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

export function getAsync<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

export function allAsync<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []) as T[]);
    });
  });
}

export function execAsync(sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function closeDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        initPromise = null;
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
}

export { db };
