/**
 * Cálculos de un turno a partir de sus horas (docs/08: shift). Puro, sin BD:
 * lo usa el formulario para mostrarlo en vivo y la server action para
 * validarlo y guardarlo — el servidor recalcula, no confía en lo que mande el
 * navegador.
 *
 * - Cruza la medianoche ⇔ la hora de fin es menor que la de inicio (22:00 → 06:00).
 * - Horas de jornada = duración del turno − duración del descanso.
 * - El descanso (si hay) va completo, con inicio y fin, y dentro del turno.
 */

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Hora → minutos desde las 00:00; null si no es válida. Tolerante con lo que
 * se escribe a mano: "7:00", "07:00", "7", "700", "7.00", "7h00" (ver normalizeTime).
 */
export function parseTime(s: string | null | undefined): number | null {
  if (!s) return null;
  const n = normalizeTime(s);
  if (!TIME_RE.test(n)) return null;
  const [h, m] = n.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Máscara mientras se escribe: trabaja sobre los dígitos (máx. 4) y pone el
 * ":" sola. El largo de la hora sale del primer dígito: 0–2 → dos dígitos
 * ("1500" → "15:00", "0700" → "07:00"); 3–9 → uno ("700" → "7:00").
 * Un ":" escrito a mano solo cuenta después de UN dígito 0–2 ("1:30") — la
 * máscara nunca produce eso sola, así que no se confunde con su propio ":"
 * (antes, "1500" terminaba en "1:50"). Al salir del campo, normalizeTime
 * completa los ceros ("7:00" → "07:00").
 */
export function maskTime(raw: string): string {
  const explicit = raw.match(/^([0-2])[:.h](\d{0,2})/);
  if (explicit) return `${explicit[1]}:${explicit[2]}`;
  const d = raw.replace(/\D/g, "").slice(0, 4);
  const hourLen = d.length > 0 && Number(d[0]) > 2 ? 1 : 2;
  if (d.length <= hourLen) return d;
  return `${d.slice(0, hourLen)}:${d.slice(hourLen, hourLen + 2)}`;
}

/**
 * Normaliza lo que se escribe a mano a "HH:MM": "630" → "06:30", "6:5" → "06:05",
 * "1330" → "13:30", "7" → "07:00". Devuelve el texto tal cual si no se puede.
 */
export function normalizeTime(raw: string): string {
  const s = raw.trim();
  if (!s) return "";
  let h: number, m: number;
  const colon = s.match(/^(\d{1,2})[:.h](\d{1,2})$/);
  if (colon) {
    h = Number(colon[1]);
    m = Number(colon[2].padEnd(2, "0"));
  } else if (/^\d{1,4}$/.test(s)) {
    if (s.length <= 2) {
      h = Number(s);
      m = 0;
    } else {
      h = Number(s.slice(0, s.length - 2));
      m = Number(s.slice(-2));
    }
  } else {
    return s;
  }
  if (h > 23 || m > 59) return s;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface ShiftTimesInput {
  start: string;
  end: string;
  breakStart?: string | null;
  breakEnd?: string | null;
}

export type ShiftTimesResult =
  | { ok: true; crossesMidnight: boolean; workedMinutes: number; hours: string }
  | { ok: false; field: "start" | "end" | "breakStart" | "breakEnd"; error: string };

/** Minutos de `t` contados desde el inicio del turno (0..1439). */
function sinceStart(t: number, start: number): number {
  return (t - start + 1440) % 1440;
}

export function computeShiftTimes(i: ShiftTimesInput): ShiftTimesResult {
  const start = parseTime(i.start);
  if (start === null) return { ok: false, field: "start", error: "Hora de inicio inválida (HH:MM, 24 h)." };
  const end = parseTime(i.end);
  if (end === null) return { ok: false, field: "end", error: "Hora de fin inválida (HH:MM, 24 h)." };
  if (start === end) return { ok: false, field: "end", error: "La hora de fin no puede ser igual a la de inicio." };

  const crossesMidnight = end < start;
  const duration = sinceStart(end, start);

  const bsRaw = i.breakStart?.trim() || "";
  const beRaw = i.breakEnd?.trim() || "";
  let breakMinutes = 0;
  if (bsRaw || beRaw) {
    if (!bsRaw) return { ok: false, field: "breakStart", error: "Falta el inicio del descanso." };
    if (!beRaw) return { ok: false, field: "breakEnd", error: "Falta el fin del descanso." };
    const bs = parseTime(bsRaw);
    if (bs === null) return { ok: false, field: "breakStart", error: "Inicio de descanso inválido (HH:MM, 24 h)." };
    const be = parseTime(beRaw);
    if (be === null) return { ok: false, field: "breakEnd", error: "Fin de descanso inválido (HH:MM, 24 h)." };
    // Todo medido desde el inicio del turno: así funciona igual si cruza la medianoche.
    const bsOff = sinceStart(bs, start);
    const beOff = sinceStart(be, start);
    if (bsOff === 0 || bsOff >= duration)
      return { ok: false, field: "breakStart", error: "El descanso tiene que empezar dentro del turno." };
    if (beOff <= bsOff || beOff >= duration)
      return { ok: false, field: "breakEnd", error: "El descanso tiene que terminar después de empezar y antes del fin del turno." };
    breakMinutes = beOff - bsOff;
  }

  const workedMinutes = duration - breakMinutes;
  return { ok: true, crossesMidnight, workedMinutes, hours: (workedMinutes / 60).toFixed(2) };
}

/** 390 → "6 h 30 min". */
export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")} min` : `${h} h`;
}
