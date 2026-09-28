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
// SYNC_MAX_REMOVALS_PCT (20), SYNC_AUDIT_CRON ("0 3 * * *": revisión nocturna de
// usuarios de cada equipo, docs/10 §4.2), WORKER_HEALTH_PORT (3001; 0 = sin healthcheck).
//
// Además, cada minuto, expira las operaciones colgadas (sweepStaleOperations).
// Antes solo corría cuando algún equipo consultaba o alguien abría el panel: la
// noche del 2026-09-27 no consultó ninguno y una corrida quedó "activa" 9 h,
// tragándose todas las corridas siguientes de ese equipo (incluida la revisión
// de las 03:00).
import { readdirSync } from "node:fs";
import path from "node:path";
import PgBoss from "pg-boss";
import { reconcileAll } from "@/lib/sync/reconcile";
import { attendancePullAll, attendanceComputeAll } from "@/lib/sync/attendance";
import { sweepStaleOperations } from "@/lib/operations/advance";
import { closeDb, prisma } from "@/lib/db";
import { startHealthServer, setWorkerState, reportWorkerError } from "./health";

const FINGERPRINTS = "sync-fingerprints";
const ATTENDANCE = "sync-attendance";
const AUDIT = "sync-audit";
const SWEEP = "sweep-operations";

function fingerprintsCron(): string {
  const n = Number(process.env.SYNC_FINGERPRINTS_INTERVAL_MIN ?? 30);
  const min = Number.isInteger(n) && n >= 1 && n <= 59 ? n : 30;
  return `*/${min} * * * *`;
}

const MIGRATION_POLL_MS = 10_000;

/**
 * Espera a que la base tenga aplicadas TODAS las migraciones que trae este
 * código antes de arrancar. En Coolify la app y el worker son servicios
 * separados sin orden de deploy entre sí; la única que migra es la app
 * (`npm run start` = `prisma migrate deploy && …`). Si el worker nuevo arranca
 * antes, espera acá en vez de correr código nuevo contra un schema viejo.
 */
async function waitForMigrations(): Promise<void> {
  const dir = path.join(process.cwd(), "prisma", "migrations");
  const expected = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  let warned = false;
  for (;;) {
    let pending = expected;
    try {
      const rows = await prisma.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM _prisma_migrations
         WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
      const applied = new Set(rows.map((r) => r.migration_name));
      pending = expected.filter((m) => !applied.has(m));
    } catch {
      // _prisma_migrations todavía no existe (base recién creada): igual, esperar
    }
    if (pending.length === 0) {
      if (warned) console.log("[worker] migraciones aplicadas por la app — arrancando.");
      return;
    }
    if (!warned) {
      setWorkerState("waiting_migrations");
      console.log(`[worker] esperando a que la app aplique ${pending.length} migración(es): ${pending.join(", ")}`);
      warned = true;
    }
    await new Promise((r) => setTimeout(r, MIGRATION_POLL_MS));
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está definida.");
  // Arriba antes que nada: Coolify lo consulta desde que arranca el contenedor.
  const health = startHealthServer();
  await waitForMigrations();
  setWorkerState("starting");
  const tz = process.env.SYNC_TZ ?? "America/Caracas";

  // Tablas propias en el schema `pgboss` (las crea la librería; no son de Prisma).
  const boss = new PgBoss({ connectionString: url, schema: "pgboss" });
  boss.on("error", (err) => {
    console.error("[worker] pg-boss:", err);
    reportWorkerError(err);
  });
  await boss.start();

  for (const q of [FINGERPRINTS, ATTENDANCE, AUDIT, SWEEP]) await boss.createQueue(q);
  await boss.schedule(FINGERPRINTS, fingerprintsCron(), {}, { tz });
  await boss.schedule(ATTENDANCE, process.env.SYNC_ATTENDANCE_CRON ?? "0 2 * * *", {}, { tz });
  await boss.schedule(AUDIT, process.env.SYNC_AUDIT_CRON ?? "0 3 * * *", {}, { tz });
  await boss.schedule(SWEEP, "* * * * *", {}, { tz });

  await boss.work(FINGERPRINTS, async () => {
    const ids = await reconcileAll("cron");
    console.log(`[worker] huellas: ${ids.length} corrida(s) encolada(s)`);
  });
  // Revisión nocturna: relee a los usuarios sin huella de cada equipo y cuadra la
  // caché por conteo (quién fue borrado desde el teclado, etc.). De noche, porque
  // cada GET_USER_INFO que se cuelga deja al equipo ~2 min sin consultar (O9).
  await boss.work(AUDIT, async () => {
    const ids = await reconcileAll("cron", undefined, { audit: true });
    console.log(`[worker] revisión nocturna: ${ids.length} equipo(s)`);
  });
  await boss.work(SWEEP, async () => {
    const n = await sweepStaleOperations();
    if (n > 0) console.log(`[worker] ${n} operación(es) expirada(s) sin respuesta del equipo`);
  });
  await boss.work(ATTENDANCE, async () => {
    const n = await attendancePullAll("cron");
    await attendanceComputeAll();
    console.log(`[worker] asistencia: ${n} pull(s) encolado(s)`);
  });

  setWorkerState("running");
  console.log(
    `[worker] listo — huellas ${fingerprintsCron()}, asistencia ${process.env.SYNC_ATTENDANCE_CRON ?? "0 2 * * *"}, ` +
      `revisión ${process.env.SYNC_AUDIT_CRON ?? "0 3 * * *"} (${tz})`
  );

  const stop = async () => {
    console.log("[worker] deteniendo…");
    setWorkerState("stopping");
    await boss.stop({ graceful: true });
    health?.close();
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
