// Worker de sincronización (docs/10-reestructura-dominio-sync.md §5).
//
// Proceso aparte de Next (misma imagen, otro comando: `npm run worker`). Usa
// pg-boss — cola de trabajos sobre el mismo Postgres, sin infra nueva — solo
// para el CRON: los trabajos encolan operaciones (RECONCILE_DEVICE, SYNC_LOGS)
// en la cola `commands` de siempre y terminan; nada acá espera al equipo, que
// sigue recibiendo sus comandos por polling. Varias instancias no se pisan:
// pg-boss entrega cada trabajo programado a una sola (SKIP LOCKED), y las
// operaciones son idempotentes por equipo (una corrida activa por dev_id).
//
// Los disparos manuales ("Sincronizar ahora") y por evento (cambio de alcance)
// no pasan por acá: la app llama directo a lib/sync/reconcile, que es instantáneo.
//
// Env: DATABASE_URL, SYNC_FINGERPRINTS_INTERVAL_MIN (30), SYNC_ATTENDANCE_CRON
// ("0 2 * * *"), SYNC_TZ ("America/Caracas"), SYNC_MAX_REMOVALS_PER_DEVICE (5),
// SYNC_MAX_REMOVALS_PCT (20).
import PgBoss from "pg-boss";
import { reconcileAll } from "@/lib/sync/reconcile";
import { attendancePullAll, attendanceComputeAll } from "@/lib/sync/attendance";
import { closeDb } from "@/lib/db";

const FINGERPRINTS = "sync-fingerprints";
const ATTENDANCE = "sync-attendance";

function fingerprintsCron(): string {
  const n = Number(process.env.SYNC_FINGERPRINTS_INTERVAL_MIN ?? 30);
  const min = Number.isInteger(n) && n >= 1 && n <= 59 ? n : 30;
  return `*/${min} * * * *`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  const tz = process.env.SYNC_TZ ?? "America/Caracas";

  // Tablas propias en el schema `pgboss` (las crea la librería; no son de Prisma).
  const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
  boss.on("error", (err) => console.error("[worker] pg-boss:", err));
  await boss.start();

  for (const q of [FINGERPRINTS, ATTENDANCE]) await boss.createQueue(q);
  await boss.schedule(FINGERPRINTS, fingerprintsCron(), {}, { tz });
  await boss.schedule(ATTENDANCE, process.env.SYNC_ATTENDANCE_CRON ?? "0 2 * * *", {}, { tz });

  await boss.work(FINGERPRINTS, async () => {
    const ids = await reconcileAll("cron");
    console.log(`[worker] huellas: ${ids.length} corrida(s) encolada(s)`);
  });
  await boss.work(ATTENDANCE, async () => {
    const n = await attendancePullAll("cron");
    await attendanceComputeAll();
    console.log(`[worker] asistencia: ${n} pull(s) encolado(s)`);
  });

  console.log(`[worker] listo — huellas ${fingerprintsCron()}, asistencia ${process.env.SYNC_ATTENDANCE_CRON ?? "0 2 * * *"} (${tz})`);

  const stop = async () => {
    console.log("[worker] deteniendo…");
    await boss.stop({ graceful: true });
    await closeDb();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error("[worker] fallo al arrancar:", err);
  process.exit(1);
});
