// Sincronización de asistencia (docs/10-reestructura-dominio-sync.md R11 / §4.6).
//
//   (a) attendance_pull — por equipo con sede: GET_LOG_DATA desde la última sync
//       exitosa (menos 1 día de solape; el unique natural descarta duplicados), o
//       el último año en lotes si nunca sincronizó (lib/operations/syncLogs).
//       Es la RED DE SEGURIDAD: verificado en hardware (T13) que el equipo guarda
//       las marcaciones hechas sin red y las reenvía solo por realtime_glog.
//   (b) attendance_compute — motor de Hito 4 (attendance_day). Todavía no existe:
//       queda como punto de enganche.
import { prisma } from "@/lib/db";
import { startSyncLogs } from "@/lib/operations";
import { interruptedYearPlan, yearCutoff } from "@/lib/operations/syncLogs";
import { isPlaceholderDevId } from "@/lib/deviceIdentity";
import type { SyncTrigger } from "./reconcile";

const DAY_MS = 24 * 3600 * 1000;
/** Igual que DEVICE_GONE_MS del reconciliador: sin consultar hace más de esto, no está. */
const DEVICE_GONE_MS = 5 * 60 * 1000;

/** Encola el pull para estos equipos (congelados/sin sede activa se saltan). Devuelve los ids de operación. */
export async function attendancePullDevices(
  devIds: string[] | null,
  trigger: SyncTrigger,
  opts: { background?: boolean } = {}
): Promise<number[]> {
  const devices = await prisma.devices.findMany({
    where: {
      ...(devIds ? { dev_id: { in: devIds } } : {}),
      site: { status: "active", company: { status: "active" } },
    },
    select: { dev_id: true, last_sync_at: true, last_seen_at: true, reported_dev_id: true, stat_log_count: true },
  });
  const ids: number[] = [];
  for (const d of devices) {
    // El pull del cron a un equipo que no está quedaría colgado hasta vencer (la
    // noche del 2026-09-27, 6 h). Se salta: al volver, onDeviceReconnect lo pide.
    const gone = d.last_seen_at == null || Date.now() - Number(d.last_seen_at) > DEVICE_GONE_MS;
    if (trigger === "cron" && gone) continue;
    // Facial con dev_id placeholder (lib/deviceIdentity): con 0 marcaciones NO
    // responde GET_LOG_DATA y la operación quedaría colgada con el candado del
    // equipo. Solo se le pide cuando su último GET_DEVICE_STATUS reportó alguna
    // (protocol-handlers lo revisa cada PLACEHOLDER_LOG_CHECK_MS).
    if (isPlaceholderDevId(d.reported_dev_id) && !(d.stat_log_count && d.stat_log_count > 0)) continue;
    try {
      const background = opts.background ?? trigger === "cron";
      // La primera vez (o si esa importación se cortó) trae el último año en lotes:
      // un equipo que viene de otro sistema ya tiene historial. Después, solo lo nuevo.
      const last = d.last_sync_at != null ? Number(d.last_sync_at) : null;
      const { id } =
        last === null || (await interruptedYearPlan(d.dev_id))
          ? await startSyncLogs(d.dev_id, { background, mode: "year" })
          : await startSyncLogs(d.dev_id, { background, since: new Date(last - DAY_MS) });
      await prisma.sync_run.create({ data: { kind: "attendance_pull", trigger, dev_id: d.dev_id, op_id: id } });
      ids.push(id);
    } catch (e) {
      console.error("[sync] no se pudo encolar el pull de asistencia de", d.dev_id, e);
    }
  }
  return ids;
}

/**
 * Equipos con sede que ya sincronizaron, pero sin ninguna marcación del último año
 * aunque el equipo o el servidor tienen marcaciones. Algo anda mal: reloj, memoria
 * llena, o lo reciente quedó en el sistema anterior. Un equipo nuevo sin marcaciones no cuenta.
 */
export async function devicesWithoutRecentMarks(companyIds: number[] | null, devId: string | null = null): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ dev_id: string }[]>`
    SELECT d.dev_id
      FROM devices d JOIN site s ON s.id = d.site_id
     WHERE d.last_sync_at IS NOT NULL
       AND (${companyIds}::int[] IS NULL OR s.company_id = ANY(${companyIds}::int[]))
       AND (${devId}::text IS NULL OR d.dev_id = ${devId})
       AND NOT EXISTS (SELECT 1 FROM attendance_logs al WHERE al.dev_id = d.dev_id AND al.io_time >= ${yearCutoff()})
       AND (COALESCE(d.stat_log_count, 0) > 0 OR EXISTS (SELECT 1 FROM attendance_logs al WHERE al.dev_id = d.dev_id))`;
  return rows.map((r) => r.dev_id);
}

/** Todos los equipos con sede activa — lo que corre el cron diario. */
export async function attendancePullAll(trigger: SyncTrigger = "cron"): Promise<number> {
  return (await attendancePullDevices(null, trigger)).length;
}

/** Hito 4: marcaciones → attendance_day de todas las empresas activas (docs/16). */
export async function attendanceComputeAll() {
  const { computeAllCompanies } = await import("@/lib/attendance/engine");
  return computeAllCompanies();
}
