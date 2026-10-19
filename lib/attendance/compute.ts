// Motor de asistencia — el cálculo de UN día de un contrato (docs/16-motor-asistencia.md).
// Puro: sin base de datos, sin zona horaria. Todo en segundos desde las 00:00 del
// día (hora de pared de la sede); un turno que cruza la medianoche termina después
// de 86 400.
//
// Reglas acordadas con el usuario (2026-10-19):
//   - entrada = primera marcación del día, salida = la última;
//   - tolerancias por defecto 10 min (tardanza y salida anticipada), ausencia por
//     defecto = "no marcó nada" — cada horario/empresa puede cambiarlas;
//   - tardanza y salida anticipada el mismo día: estado "Tardanza", con los dos minutos guardados;
//   - marcaciones en un día no laborable = "día libre trabajado", todas sus horas son extra;
//   - jornada = las horas cargadas en el turno; si no hay, fin − inicio − descanso.

export type AbsenceRule = "no_check_in" | "no_marks" | "under_hours";

export type DayStatus =
  | "present"
  | "late"
  | "early_leave"
  | "absent"
  | "incomplete"
  | "rest_day"
  | "rest_day_worked"
  | "no_schedule";

export interface Thresholds {
  lateToleranceMin: number;
  earlyLeaveToleranceMin: number;
  absenceRule: AbsenceRule;
  /** Solo para "under_hours": menos de esto trabajado = ausente. */
  absenceMinHours: number | null;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  lateToleranceMin: 10,
  earlyLeaveToleranceMin: 10,
  absenceRule: "no_marks",
  absenceMinHours: null,
};

/** El turno de ese día, en segundos desde las 00:00 del día. */
export interface DayShift {
  shiftId: number;
  start: number;
  /** Mayor que 86 400 si cruza la medianoche. */
  end: number;
  breakStart: number | null;
  breakEnd: number | null;
  /** Jornada esperada, en segundos. */
  scheduled: number;
  /** "Entrada y salida variable": solo se cuentan horas, sin tardanzas ni salidas anticipadas. */
  variable: boolean;
}

/** Qué le toca a la persona ese día según su horario. */
export type DayPlan =
  | { kind: "work"; shift: DayShift }
  | { kind: "rest" } // el horario no trabaja ese día
  | { kind: "none" }; // el contrato no tiene horario (o ningún turno vigente esa fecha)

export interface DayResult {
  status: DayStatus;
  /** Segundos desde las 00:00 del día (puede pasar de 86 400 en turnos nocturnos). */
  firstIn: number | null;
  lastOut: number | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  scheduledMinutes: number | null;
  markCount: number;
  shiftId: number | null;
}

const DAY = 86_400;
/** Una salida de turno nocturno puede llegar hasta 6 h después del fin y sigue siendo de ese turno. */
const NIGHT_SPILL = 6 * 3600;
/** Se puede llegar hasta 4 h antes del inicio del turno y cuenta para ese día. */
const EARLY_ARRIVAL = 4 * 3600;

const toMin = (s: number) => Math.floor(s / 60);

/** Segundos de descanso que caen dentro de lo trabajado. */
function breakOverlap(shift: DayShift, firstIn: number, lastOut: number): number {
  if (shift.breakStart == null || shift.breakEnd == null) return 0;
  return Math.max(0, Math.min(lastOut, shift.breakEnd) - Math.max(firstIn, shift.breakStart));
}

/**
 * Calcula el día. `marks` en segundos desde las 00:00 del día, en cualquier orden
 * (ya sin repetidas). Devuelve null si no hay nada que guardar (sin horario y sin marcar).
 */
export function computeDay(plan: DayPlan, marksIn: number[], t: Thresholds): DayResult | null {
  const marks = [...marksIn].sort((a, b) => a - b);
  const n = marks.length;
  const firstIn = n > 0 ? marks[0] : null;
  const lastOut = n > 1 ? marks[n - 1] : null;
  const base = {
    firstIn,
    lastOut,
    markCount: n,
    lateMinutes: null,
    earlyLeaveMinutes: null,
  };

  if (plan.kind === "none") {
    if (n === 0) return null;
    const worked = lastOut != null ? toMin(lastOut - firstIn!) : null;
    return { ...base, status: "no_schedule", workedMinutes: worked, overtimeMinutes: null, scheduledMinutes: null, shiftId: null };
  }

  if (plan.kind === "rest") {
    if (n === 0) {
      return { ...base, status: "rest_day", workedMinutes: null, overtimeMinutes: null, scheduledMinutes: null, shiftId: null };
    }
    const worked = lastOut != null ? toMin(lastOut - firstIn!) : null;
    return { ...base, status: "rest_day_worked", workedMinutes: worked, overtimeMinutes: worked, scheduledMinutes: null, shiftId: null };
  }

  const s = plan.shift;
  const scheduledMinutes = toMin(s.scheduled);
  const common = { scheduledMinutes, shiftId: s.shiftId };

  if (n === 0) {
    return { ...base, ...common, status: "absent", workedMinutes: 0, overtimeMinutes: null };
  }

  const workedSec = lastOut != null ? Math.max(0, lastOut - firstIn! - breakOverlap(s, firstIn!, lastOut)) : 0;
  const workedMinutes = toMin(workedSec);
  const overtimeMinutes = lastOut != null ? Math.max(0, workedMinutes - scheduledMinutes) : null;

  // Ausencia según la regla del horario/empresa.
  const absent =
    t.absenceRule === "no_check_in"
      ? firstIn! > (s.start + s.end) / 2 // no marcó en la primera mitad del turno
      : t.absenceRule === "under_hours"
        ? t.absenceMinHours != null && workedSec < t.absenceMinHours * 3600
        : false; // "no_marks": ya se vio que marcó
  if (absent) {
    return { ...base, ...common, status: "absent", workedMinutes, overtimeMinutes };
  }

  if (n === 1) {
    return { ...base, ...common, status: "incomplete", workedMinutes: null, overtimeMinutes: null };
  }

  if (s.variable) {
    return { ...base, ...common, status: "present", workedMinutes, overtimeMinutes };
  }

  const lateSec = firstIn! - s.start;
  const earlySec = s.end - lastOut!;
  const lateMinutes = lateSec > t.lateToleranceMin * 60 ? toMin(lateSec) : null;
  const earlyLeaveMinutes = earlySec > t.earlyLeaveToleranceMin * 60 ? toMin(earlySec) : null;
  const status: DayStatus = lateMinutes != null ? "late" : earlyLeaveMinutes != null ? "early_leave" : "present";
  return { ...base, ...common, status, workedMinutes, overtimeMinutes, lateMinutes, earlyLeaveMinutes };
}

/** Una marcación ya ubicada en su fecha calendario (hora de pared de la sede). */
export interface WallMark {
  /** "YYYY-MM-DD" */
  ymd: string;
  /** Segundos desde las 00:00 de esa fecha. */
  sec: number;
}

/** "YYYY-MM-DD" ± días. */
export function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Reparte las marcaciones en los días de trabajo: una marcación de la madrugada
 * es del día anterior si ese día tenía un turno que cruza la medianoche y la
 * marcación cae hasta 6 h después de su fin — salvo que ya esté dentro del
 * margen de llegada del turno del día propio. El resto, a su fecha calendario.
 * Devuelve, por fecha, los segundos desde las 00:00 de ESA fecha (los del
 * día siguiente quedan por encima de 86 400).
 */
export function assignMarksToDays(marks: WallMark[], planFor: (ymd: string) => DayPlan): Map<string, number[]> {
  const out = new Map<string, number[]>();
  const push = (ymd: string, sec: number) => out.set(ymd, [...(out.get(ymd) ?? []), sec]);
  for (const m of marks) {
    const prevYmd = addDays(m.ymd, -1);
    const prev = planFor(prevYmd);
    const today = planFor(m.ymd);
    const prevSpill =
      prev.kind === "work" && prev.shift.end > DAY && m.sec + DAY <= prev.shift.end + NIGHT_SPILL;
    const inTodayWindow = today.kind === "work" && m.sec >= today.shift.start - EARLY_ARRIVAL;
    if (prevSpill && !inTodayWindow) push(prevYmd, m.sec + DAY);
    else push(m.ymd, m.sec);
  }
  return out;
}

/** "HH:MM" → segundos; null si falta o no es válida. */
export function hhmmToSec(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? h * 3600 + mi * 60 : null;
}

/**
 * Turno guardado (texto "HH:MM", horas decimales) → DayShift en segundos. Cruza la
 * medianoche si el fin es menor o igual que el inicio, o si está marcado así.
 */
export function toDayShift(sh: {
  id: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  hours: number | string | null;
  variable_in_out: boolean;
  crosses_midnight?: boolean;
}): DayShift | null {
  const start = hhmmToSec(sh.start_time);
  let end = hhmmToSec(sh.end_time);
  if (start == null || end == null) return null;
  if (end <= start) end += DAY; // 22:00 → 06:00 cruza la medianoche (como computeShiftTimes)
  let bs = hhmmToSec(sh.break_start);
  let be = hhmmToSec(sh.break_end);
  if (bs != null && be != null) {
    if (end > DAY && bs < start) bs += DAY;
    if (be < bs) be += DAY;
  } else {
    bs = null;
    be = null;
  }
  const breakSec = bs != null && be != null ? be - bs : 0;
  const hours = sh.hours == null ? null : Number(sh.hours);
  const scheduled = hours != null && Number.isFinite(hours) && hours > 0 ? Math.round(hours * 3600) : end - start - breakSec;
  return { shiftId: sh.id, start, end, breakStart: bs, breakEnd: be, scheduled, variable: sh.variable_in_out };
}

/** Día ISO de la semana de "YYYY-MM-DD": 1 = lunes … 7 = domingo (como shift.workdays). */
export function isoWeekday(ymd: string): number {
  const d = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
