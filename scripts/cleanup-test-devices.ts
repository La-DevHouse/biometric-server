// Removes devices left behind by testing (E2E_TEST_*, SIM001, TEST001,
// DEV_TEST, TEST_ARRAY, TEST_ENROLL, TEST_SIMPLE, ...) so the admin
// dashboard's device list only shows real hardware.
//
// Dry-run by default — prints what would be deleted without touching
// anything. Pass --apply to actually delete.
//
//   npx tsx scripts/cleanup-test-devices.ts            # dry run
//   npx tsx scripts/cleanup-test-devices.ts --apply    # deletes

import { initDb, allAsync, runAsync, closeDb } from "@/lib/db";

// Deliberately conservative: matches only well-known test naming patterns.
// A device serial from a real terminal never looks like these — real
// serials seen so far are plain numeric strings (e.g. "2023081158"), never
// containing the word "test" anywhere. `TEST` can appear as a prefix
// (TEST001), a suffix (CURL_TEST, SNIFF_TEST), or in the middle
// (E2E_TEST_..., DEV_TEST) — hence a plain substring match rather than
// anchoring to the start of the string.
const TEST_PATTERNS = [/TEST/i, /^SIM\d*$/];

function isTestDevice(devId: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(devId));
}

const CHILD_TABLES = ["operations", "commands", "attendance_logs", "enroll_data", "users", "raw_traffic", "block_buffer"];

async function main() {
  await initDb();

  const apply = process.argv.includes("--apply");
  const devices = await allAsync<{ dev_id: string }>(`SELECT dev_id FROM devices ORDER BY dev_id`);
  const toDelete = devices.filter((d) => isTestDevice(d.dev_id)).map((d) => d.dev_id);

  // A real device always has a `devices` row — handleReceiveCmd upserts one
  // on every poll. A child-table row with no matching device can only be
  // debris (e.g. from a device row deleted independently earlier), whether
  // or not its dev_id happens to match a test naming pattern.
  const orphanRows: Record<string, Array<{ dev_id: string; n: number }>> = {};
  for (const table of CHILD_TABLES) {
    const rows = await allAsync<{ dev_id: string; n: number }>(
      `SELECT dev_id, COUNT(*) AS n FROM ${table}
        WHERE dev_id IS NOT NULL AND dev_id NOT IN (SELECT dev_id FROM devices)
        GROUP BY dev_id`
    );
    if (rows.length > 0) orphanRows[table] = rows;
  }
  const hasOrphans = Object.keys(orphanRows).length > 0;

  if (toDelete.length === 0 && !hasOrphans) {
    console.log("No hay dispositivos de prueba ni filas huérfanas que limpiar.");
    await closeDb();
    return;
  }

  console.log(`${apply ? "Borrando" : "Se borrarían (dry-run, usa --apply para borrar de verdad)"}:`);
  for (const devId of toDelete) console.log(`  - dispositivo ${devId} (y sus filas relacionadas)`);
  for (const [table, rows] of Object.entries(orphanRows)) {
    for (const r of rows) console.log(`  - ${r.n} fila(s) huérfana(s) en ${table} para dev_id="${r.dev_id}" (sin dispositivo)`);
  }

  if (!apply) {
    await closeDb();
    return;
  }

  for (const devId of toDelete) {
    for (const table of CHILD_TABLES) await runAsync(`DELETE FROM ${table} WHERE dev_id = ?`, [devId]);
    await runAsync(`DELETE FROM devices WHERE dev_id = ?`, [devId]);
  }
  for (const table of CHILD_TABLES) {
    await runAsync(`DELETE FROM ${table} WHERE dev_id IS NOT NULL AND dev_id NOT IN (SELECT dev_id FROM devices)`);
  }
  console.log(`${toDelete.length} dispositivo(s) y sus filas relacionadas, más las filas huérfanas listadas arriba, eliminados.`);
  await closeDb();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
