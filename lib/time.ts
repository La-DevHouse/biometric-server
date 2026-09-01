// Manejo de zona horaria. El servidor corre en UTC (Coolify/Hetzner); los
// dispositivos y los cálculos de asistencia trabajan en hora local de la sede.
//
// - `io_time` del protocolo se guarda como texto "YYYYMMDDhhmmss" tal cual lo
//   manda el equipo: hora de pared local, SIN convertir. La interpretación a
//   instante UTC ocurre acá (motor de asistencia), no en la ingesta.
// - SET_TIME al equipo debe mandar la hora de pared de SU zona, no la del
//   servidor.
//
// Implementado solo con `Intl` — sin dependencias. DST-aware (aunque Venezuela
// no tiene DST). Multi-zona: cada `site` lleva su `timezone` IANA; sin sede se
// usa DEFAULT_TZ.

export const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE || "America/Caracas";

/** Opciones del selector de zona en el form de sede. Se acepta cualquier IANA válida. */
export const COMMON_TIMEZONES = [
  "America/Caracas",
  "America/Bogota",
  "America/Lima",
  "America/Santiago",
  "America/Argentina/Buenos_Aires",
  "America/Mexico_City",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Europe/Madrid",
  "UTC",
] as const;

/** Valida un identificador IANA ("America/Caracas", "UTC", …). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** Componentes de hora de pared que `tz` muestra para un instante dado. */
export function wallPartsInTz(instant: Date, tz: string): WallParts {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  // hour12:false puede devolver "24" a medianoche en algunos entornos
  const hour = get("hour") % 24;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Instante -> "YYYYMMDDhhmmss" de hora de pared en `tz` (formato del equipo). */
export function formatDeviceTime(instant: Date, tz: string = DEFAULT_TZ): string {
  const w = wallPartsInTz(instant, tz);
  const pad = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${pad(w.year, 4)}${pad(w.month)}${pad(w.day)}${pad(w.hour)}${pad(w.minute)}${pad(w.second)}`;
}

/** Offset de `tz` (ms a sumar a UTC para obtener la hora de pared) en `instant`. */
function tzOffsetMs(instant: Date, tz: string): number {
  const w = wallPartsInTz(instant, tz);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - instant.getTime();
}

/**
 * Hora de pared en `tz` -> instante UTC. `wall` puede ser "YYYYMMDDhhmmss" o
 * "YYYY-MM-DDThh:mm(:ss)". Aproximación de 1 iteración: exacta salvo dentro de
 * la ventana de ~1h de un salto DST (Venezuela no tiene DST). `null` si el
 * formato es inválido.
 */
export function parseDeviceTime(wall: string, tz: string = DEFAULT_TZ): Date | null {
  let y: number, mo: number, d: number, h: number, mi: number, s: number;
  const compact = wall.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
  const iso = wall.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (compact) {
    y = +compact[1]; mo = +compact[2]; d = +compact[3];
    h = +compact[4]; mi = +compact[5]; s = +compact[6];
  } else if (iso) {
    y = +iso[1]; mo = +iso[2]; d = +iso[3];
    h = +iso[4]; mi = +iso[5]; s = iso[6] ? +iso[6] : 0;
  } else {
    return null;
  }
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(guess)) return null;
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

/** "YYYY-MM-DD" del día de pared en `tz` para un instante (bucketing de asistencia). */
export function dateKeyInTz(instant: Date, tz: string = DEFAULT_TZ): string {
  const w = wallPartsInTz(instant, tz);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${w.year}-${pad(w.month)}-${pad(w.day)}`;
}
