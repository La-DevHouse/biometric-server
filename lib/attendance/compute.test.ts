import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  computeDay,
  assignMarksToDays,
  toDayShift,
  isoWeekday,
  addDays,
  DEFAULT_THRESHOLDS as T,
  type DayPlan,
} from "./compute";

const at = (hhmm: string, nextDay = false) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 3600 + m * 60 + (nextDay ? 86_400 : 0);
};
const shift = (start: string, end: string, extra: Partial<Parameters<typeof toDayShift>[0]> = {}) =>
  toDayShift({ id: 1, start_time: start, end_time: end, break_start: null, break_end: null, hours: null, variable_in_out: false, ...extra })!;
const work = (s = shift("08:00", "17:00", { break_start: "12:00", break_end: "13:00", hours: 8 })): DayPlan => ({ kind: "work", shift: s });

test("turno diurno: presente, horas sin el descanso y extra de referencia", () => {
  const r = computeDay(work(), [at("07:55"), at("12:30"), at("17:05")], T)!;
  assert.equal(r.status, "present");
  assert.equal(r.markCount, 3);
  assert.equal(r.workedMinutes, 9 * 60 + 10 - 60); // 07:55 → 17:05 menos 1 h de descanso
  assert.equal(r.overtimeMinutes, 10);
  assert.equal(r.scheduledMinutes, 8 * 60);
});

test("tolerancia de 10 min: 08:09 es presente, 08:15 es tardanza con sus minutos", () => {
  assert.equal(computeDay(work(), [at("08:09"), at("17:00")], T)!.status, "present");
  const late = computeDay(work(), [at("08:15"), at("17:00")], T)!;
  assert.equal(late.status, "late");
  assert.equal(late.lateMinutes, 15);
  assert.equal(late.earlyLeaveMinutes, null);
});

test("tardanza y salida anticipada el mismo día: estado Tardanza, con los dos minutos", () => {
  const r = computeDay(work(), [at("08:20"), at("16:30")], T)!;
  assert.equal(r.status, "late");
  assert.equal(r.lateMinutes, 20);
  assert.equal(r.earlyLeaveMinutes, 30);
  const early = computeDay(work(), [at("08:00"), at("16:45")], T)!;
  assert.equal(early.status, "early_leave");
  assert.equal(early.earlyLeaveMinutes, 15);
});

test("una sola marcación = incompleto; ninguna en día laborable = ausente", () => {
  assert.equal(computeDay(work(), [at("08:00")], T)!.status, "incomplete");
  const abs = computeDay(work(), [], T)!;
  assert.equal(abs.status, "absent");
  assert.equal(abs.workedMinutes, 0);
});

test("reglas de ausencia: no marcó entrada, menos de X horas", () => {
  const noCheckIn = { ...T, absenceRule: "no_check_in" as const };
  assert.equal(computeDay(work(), [at("15:00"), at("17:00")], noCheckIn)!.status, "absent", "primera marca después de la mitad del turno");
  assert.equal(computeDay(work(), [at("08:00"), at("17:00")], noCheckIn)!.status, "present");
  const underHours = { ...T, absenceRule: "under_hours" as const, absenceMinHours: 4 };
  assert.equal(computeDay(work(), [at("08:00"), at("11:00")], underHours)!.status, "absent", "3 h < 4 h");
  assert.equal(computeDay(work(), [at("08:00"), at("13:30")], underHours)!.status, "early_leave", "08:00–13:30 = 5.5 h − 1 h de descanso = 4.5 h ≥ 4 h");
});

test("día libre: sin marcar = día libre; marcando = día libre trabajado, todo extra", () => {
  assert.equal(computeDay({ kind: "rest" }, [], T)!.status, "rest_day");
  const r = computeDay({ kind: "rest" }, [at("09:00"), at("13:00")], T)!;
  assert.equal(r.status, "rest_day_worked");
  assert.equal(r.workedMinutes, 240);
  assert.equal(r.overtimeMinutes, 240);
});

test("sin horario: solo horas; sin marcar no genera fila", () => {
  const r = computeDay({ kind: "none" }, [at("08:00"), at("16:00")], T)!;
  assert.equal(r.status, "no_schedule");
  assert.equal(r.workedMinutes, 480);
  assert.equal(r.lateMinutes, null);
  assert.equal(computeDay({ kind: "none" }, [], T), null);
});

test("entrada y salida variable: solo horas, sin tardanza", () => {
  const r = computeDay(work(shift("08:00", "17:00", { variable_in_out: true })), [at("10:00"), at("15:00")], T)!;
  assert.equal(r.status, "present");
  assert.equal(r.lateMinutes, null);
  assert.equal(r.workedMinutes, 300);
});

test("jornada: las horas del turno si están; si no, fin − inicio − descanso", () => {
  assert.equal(shift("08:00", "17:00", { break_start: "12:00", break_end: "13:00" }).scheduled, 8 * 3600);
  assert.equal(shift("08:00", "17:00", { hours: 7.5 }).scheduled, 7.5 * 3600);
  assert.equal(shift("22:00", "06:00").scheduled, 8 * 3600, "nocturno");
});

test("turno nocturno 22:00–06:00: la salida de la madrugada es del día en que empezó", () => {
  const night = shift("22:00", "06:00");
  const planFor = (): DayPlan => ({ kind: "work", shift: night });
  const days = assignMarksToDays(
    [
      { ymd: "2026-10-05", sec: at("21:58") },
      { ymd: "2026-10-06", sec: at("06:03") }, // salida del turno del 5
      { ymd: "2026-10-06", sec: at("21:55") }, // entrada del turno del 6
    ],
    planFor
  );
  assert.deepEqual(days.get("2026-10-05"), [at("21:58"), at("06:03", true)]);
  assert.deepEqual(days.get("2026-10-06"), [at("21:55")]);
  const r = computeDay(planFor(), days.get("2026-10-05")!, T)!;
  assert.equal(r.status, "present");
  assert.equal(r.workedMinutes, 8 * 60 + 5);
});

test("una marca de madrugada sin turno nocturno el día anterior queda en su fecha", () => {
  const day = shift("08:00", "17:00");
  const days = assignMarksToDays([{ ymd: "2026-10-06", sec: at("02:00") }], () => ({ kind: "work", shift: day }));
  assert.deepEqual(days.get("2026-10-06"), [at("02:00")]);
});

test("utilidades de fecha", () => {
  assert.equal(isoWeekday("2026-10-19"), 1, "lunes");
  assert.equal(isoWeekday("2026-10-18"), 7, "domingo");
  assert.equal(addDays("2026-10-31", 1), "2026-11-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
