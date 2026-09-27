// Hora del equipo, corregida sola.
//
// Cada consulta del equipo (receive_cmd, cada ~11 s) trae su reloj en `fk_time`
// ("YYYYMMDDhhmmss", hora de pared). Se compara contra la hora del servidor en
// la zona de la sede y, si se desvía más de CLOCK_MAX_DRIFT_S (120 s por
// defecto), se encola un SYNC_CLOCK — el mismo "Sincronizar hora" del panel.
// No hace falta cron: se detecta en la primera consulta, gratis.
//
// Nunca frena la respuesta al equipo (se dispara aparte) y tiene un enfriamiento
// por equipo, así un equipo que no acepta SET_TIME no queda en un bucle.
import { getAsync } from "@/lib/db";
import { DEFAULT_TZ, parseDeviceTime } from "@/lib/time";
import { startSyncClock } from "@/lib/operations";

const MAX_DRIFT_MS = (Number(process.env.CLOCK_MAX_DRIFT_S) || 120) * 1000;
const COOLDOWN_MS = 15 * 60 * 1000;

const lastAttempt = new Map<string, number>();

/** "YYYYMMDDhhmmss" o "YYMMDDhhmmss" (visto en la documentación del protocolo). */
function normalizeFkTime(fkTime: string): string | null {
  const s = fkTime.trim();
  if (/^\d{14}$/.test(s)) return s;
  if (/^\d{12}$/.test(s)) return `20${s}`;
  return null;
}

/** Desvío (ms, con signo: + adelantado) del reloj del equipo; null si no se puede leer. */
export function clockDriftMs(fkTime: string | null | undefined, tz: string, now: number = Date.now()): number | null {
  if (!fkTime) return null;
  const norm = normalizeFkTime(fkTime);
  if (!norm) return null;
  const t = parseDeviceTime(norm, tz);
  return t ? t.getTime() - now : null;
}

/** Dispara (sin esperar) un SYNC_CLOCK si el reloj del equipo está desviado. */
export function maybeAutoSyncClock(devId: string, fkTime: string | null | undefined): void {
  const now = Date.now();
  const quick = clockDriftMs(fkTime, DEFAULT_TZ, now);
  // Chequeo barato en memoria primero: casi siempre está bien y no se toca la BD.
  if (quick === null || Math.abs(quick) < MAX_DRIFT_MS) return;
  const last = lastAttempt.get(devId);
  if (last && now - last < COOLDOWN_MS) return;
  lastAttempt.set(devId, now);

  void (async () => {
    // Recalcular con la zona real de la sede (una sede fuera de Caracas no es un desvío).
    const row = await getAsync<{ timezone: string | null }>(
      `SELECT s.timezone FROM devices d LEFT JOIN site s ON s.id = d.site_id WHERE d.dev_id = ?`,
      [devId]
    );
    const drift = clockDriftMs(fkTime, row?.timezone || DEFAULT_TZ, now);
    if (drift === null || Math.abs(drift) < MAX_DRIFT_MS) return;
    const { id } = await startSyncClock(devId);
    console.log(`[reloj] ${devId}: desvío de ${Math.round(drift / 1000)} s (fk_time ${fkTime}) → Sincronizar hora (op ${id})`);
  })().catch((err) => console.error("[reloj] no se pudo sincronizar la hora de", devId, err));
}
