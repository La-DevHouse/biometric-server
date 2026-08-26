// Removes duplicate attendance_logs rows sharing the same natural key
// (dev_id, user_id, io_time) — see lib/operations/persist.ts for why that's
// the right key. Deliberately NOT run automatically inside lib/db.ts's
// migrate(): a UNIQUE index there is best-effort and skips itself if
// duplicates already exist, so cleanup is a separate, explicit, opt-in step.
//
// Dry-run by default — prints what would be deleted without touching
// anything. Pass --apply to actually delete.
//
//   npx tsx scripts/dedupe-attendance.ts            # dry run
//   npx tsx scripts/dedupe-attendance.ts --apply    # deletes
//
// Keeps the richest row per duplicate group: the one with log_image if any
// group member has one (only realtime_glog carries a photo; a GET_LOG_DATA
// sync never does), otherwise the oldest by id.

import { initDb, allAsync, runAsync, closeDb } from "@/lib/db";

async function main() {
  await initDb();
  const apply = process.argv.includes("--apply");

  const dupeGroups = await allAsync<{ dev_id: string; user_id: string; io_time: string; n: number }>(
    `SELECT dev_id, user_id, io_time, COUNT(*) AS n
       FROM attendance_logs
      GROUP BY dev_id, user_id, io_time
     HAVING COUNT(*) > 1`
  );

  if (dupeGroups.length === 0) {
    console.log("No hay marcaciones duplicadas.");
    await closeDb();
    return;
  }

  const totalExtra = dupeGroups.reduce((sum, g) => sum + (g.n - 1), 0);
  console.log(
    `${dupeGroups.length} grupo(s) duplicados, ${totalExtra} fila(s) de más ` +
      `${apply ? "se van a borrar" : "se borrarían (dry-run, usa --apply para borrar de verdad)"}.`
  );
  for (const g of dupeGroups.slice(0, 20)) {
    console.log(`  - dev=${g.dev_id} user=${g.user_id} io_time=${g.io_time} (${g.n} copias)`);
  }
  if (dupeGroups.length > 20) console.log(`  ... y ${dupeGroups.length - 20} más`);

  if (!apply) {
    await closeDb();
    return;
  }

  // Requires SQLite >= 3.25 for window functions; sqlite3@5.1.7 bundles a
  // much newer version, so this is safe in this project.
  await runAsync(
    `DELETE FROM attendance_logs WHERE id NOT IN (
       SELECT id FROM (
         SELECT id, ROW_NUMBER() OVER (
           PARTITION BY dev_id, user_id, io_time
           ORDER BY (log_image IS NOT NULL) DESC, id ASC
         ) AS rn
         FROM attendance_logs
       ) WHERE rn = 1
     )`
  );
  console.log(`${totalExtra} fila(s) duplicada(s) eliminada(s).`);
  await closeDb();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
