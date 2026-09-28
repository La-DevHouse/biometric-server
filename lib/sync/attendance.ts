// Sincronización de asistencia (docs/10-reestructura-dominio-sync.md R11 / §4.6).
//
//   (a) attendance_pull — por equipo con sede: GET_LOG_DATA desde la última sync
//       exitosa (menos 1 día de solape; el unique natural descarta duplicados).
//       Es la RED DE SEGURIDAD: verificado en hardware (T13) que el equipo guarda
//       las marcaciones hechas sin red y las reenvía solo por realtime_glog.
//   (b) attendance_compute — motor de Hito 4 (attendance_day). Todavía no existe:
//       queda como punto de enganche.
import { prisma } from "@/lib/db";
import { startSyncLogs } from "@/lib/operations";
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
    select: { dev_id: true, last_sync_at: true, last_seen_at: true },
  });
  const ids: number[] = [];
  for (const d of devices) {
    // El pull del cron a un equipo que no está quedaría colgado hasta vencer (la
    // noche del 2026-09-27, 6 h). Se salta: al volver, onDeviceReconnect lo pide.
    const gone = d.last_seen_at == null || Date.now() - Number(d.last_seen_at) > DEVICE_GONE_MS;
    if (trigger === "cron" && gone) continue;
    try {
      const last = d.last_sync_at != null ? Number(d.last_sync_at) : null;
      const since = new Date((last ?? Date.now() - 7 * DAY_MS) - DAY_MS);
      const { id } = await startSyncLogs(d.dev_id, { background: opts.background ?? trigger === "cron", since });
      await prisma.sync_run.create({ data: { kind: "attendance_pull", trigger, dev_id: d.dev_id, op_id: id } });
      ids.push(id);
    } catch (e) {
      console.error("[sync] no se pudo encolar el pull de asistencia de", d.dev_id, e);
    }
  }
  return ids;
}

/** Todos los equipos con sede activa — lo que corre el cron diario. */
export async function attendancePullAll(trigger: SyncTrigger = "cron"): Promise<number> {
  return (await attendancePullDevices(null, trigger)).length;
}

/** Hito 4: procesar marcajes → attendance_day. Sin motor todavía (docs/10 §4.6 b). */
export async function attendanceComputeAll(): Promise<void> {
  // intencionalmente vacío hasta que exista el motor de asistencia
}
