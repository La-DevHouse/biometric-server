// Motor de asistencia — calcula y guarda los días de los contratos de una empresa
// (docs/16-motor-asistencia.md). El cálculo de cada día está en ./compute (puro);
// acá se junta lo que necesita: horario y tolerancias del contrato, y las mismas
// marcaciones que muestra y exporta Empresa → Asistencia (companyAttendance: sin
// repetidas, con el historial de sede, por contrato).
//
// Idempotente: un día por contrato y fecha (upsert). Recalcular reemplaza, no
// duplica. Días de un contrato que ya no corresponden en el rango (cambió la
// fecha del contrato, se le quitó el horario y ya no marcó) se borran.
import { prisma } from "@/lib/db";
import { companyAttendance } from "@/lib/companyAttendance";
import { DEFAULT_TZ, dateKeyInTz, parseDeviceTime } from "@/lib/time";
import {
  addDays,
  assignMarksToDays,
  computeDay,
  DEFAULT_THRESHOLDS,
  isoWeekday,
  toDayShift,
  type AbsenceRule,
  type DayPlan,
  type DayShift,
  type DayStatus,
  type Thresholds,
  type WallMark,
} from "./compute";

const DAY = 86_400;
const ymdOf = (d: Date) => d.toISOString().slice(0, 10);

interface ShiftRow {
  id: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  hours: unknown;
  variable_in_out: boolean;
  workdays: number[];
  effective_from: Date;
  effective_to: Date | null;
}

/** Qué le toca ese día según los turnos del horario (vigencia + días laborables). */
export function planForDate(shifts: ShiftRow[] | null, ymd: string): DayPlan {
  if (!shifts) return { kind: "none" };
  const effective = shifts.filter((s) => ymdOf(s.effective_from) <= ymd && (!s.effective_to || ymdOf(s.effective_to) >= ymd));
  if (effective.length === 0) return { kind: "none" };
  const wd = isoWeekday(ymd);
  const today = effective
    .filter((s) => s.workdays.includes(wd))
    .map((s) => toDayShift({ ...s, hours: s.hours == null ? null : String(s.hours) }))
    .filter((s): s is DayShift => s != null)
    .sort((a, b) => a.start - b.start);
  return today.length ? { kind: "work", shift: today[0] } : { kind: "rest" };
}

function thresholdsFor(
  group: { late_tolerance_min: number | null; early_leave_tolerance_min: number | null; absence_rule: string | null; absence_min_hours: number | null } | null,
  company: { late_tolerance_min: number | null; early_leave_tolerance_min: number | null; absence_rule: string | null; absence_min_hours: number | null }
): Thresholds {
  return {
    lateToleranceMin: group?.late_tolerance_min ?? company.late_tolerance_min ?? DEFAULT_THRESHOLDS.lateToleranceMin,
    earlyLeaveToleranceMin:
      group?.early_leave_tolerance_min ?? company.early_leave_tolerance_min ?? DEFAULT_THRESHOLDS.earlyLeaveToleranceMin,
    absenceRule: ((group?.absence_rule ?? company.absence_rule) as AbsenceRule | null) ?? DEFAULT_THRESHOLDS.absenceRule,
    absenceMinHours: group?.absence_min_hours ?? company.absence_min_hours ?? DEFAULT_THRESHOLDS.absenceMinHours,
  };
}

/** Segundos desde las 00:00 de `ymd` (puede pasar de un día) → instante, en la zona de la sede. */
function toInstant(ymd: string, sec: number, tz: string): Date | null {
  const day = addDays(ymd, Math.floor(sec / DAY));
  const s = sec % DAY;
  const pad = (n: number) => String(n).padStart(2, "0");
  const wall = `${day.replace(/-/g, "")}${pad(Math.floor(s / 3600))}${pad(Math.floor((s % 3600) / 60))}${pad(s % 60)}`;
  return parseDeviceTime(wall, tz);
}

export interface ComputeSummary {
  employments: number;
  days: number;
  removed: number;
  byStatus: Partial<Record<DayStatus, number>>;
}

/**
 * Calcula los días de [from, to] ("YYYY-MM-DD", inclusive) de todos los contratos
 * de la empresa. Nunca calcula el día de hoy ni días futuros (`today`, por defecto
 * hoy en Caracas): un día se cierra cuando termina — así no aparece "ausente" a
 * las 7 de la mañana.
 */
export async function computeCompanyAttendance(
  companyId: number,
  from: string,
  to: string,
  opts: { today?: string } = {}
): Promise<ComputeSummary> {
  const today = opts.today ?? dateKeyInTz(new Date(), DEFAULT_TZ);
  const last = to < today ? to : addDays(today, -1);
  const summary: ComputeSummary = { employments: 0, days: 0, removed: 0, byStatus: {} };
  if (last < from) return summary;

  const company = await prisma.client_company.findUnique({
    where: { id: companyId },
    select: { late_tolerance_min: true, early_leave_tolerance_min: true, absence_rule: true, absence_min_hours: true },
  });
  if (!company) return summary;

  const employments = await prisma.employment.findMany({
    where: {
      company_id: companyId,
      start_date: { lte: new Date(`${last}T00:00:00Z`) },
      OR: [{ end_date: null }, { end_date: { gte: new Date(`${from}T00:00:00Z`) } }],
    },
    select: {
      id: true,
      employee_id: true,
      start_date: true,
      end_date: true,
      schedule_group: {
        select: {
          status: true,
          late_tolerance_min: true,
          early_leave_tolerance_min: true,
          absence_rule: true,
          absence_min_hours: true,
          shifts: {
            select: {
              id: true,
              start_time: true,
              end_time: true,
              break_start: true,
              break_end: true,
              hours: true,
              variable_in_out: true,
              workdays: true,
              effective_from: true,
              effective_to: true,
            },
          },
        },
      },
    },
  });
  if (employments.length === 0) return summary;

  // Marcaciones con un día de margen a cada lado (turnos que cruzan la medianoche).
  const marks = await companyAttendance(companyId, { from: addDays(from, -1), to: addDays(last, 1), order: "asc" });
  const siteIds = [...new Set(marks.map((m) => m.site_id))];
  const tzBySite = new Map(
    (await prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, timezone: true } })).map((s) => [s.id, s.timezone])
  );
  const byEmployee = new Map<number, { wall: WallMark; tz: string }[]>();
  for (const m of marks) {
    const io = m.io_time;
    if (!/^\d{14}$/.test(io)) continue;
    const wall: WallMark = {
      ymd: `${io.slice(0, 4)}-${io.slice(4, 6)}-${io.slice(6, 8)}`,
      sec: Number(io.slice(8, 10)) * 3600 + Number(io.slice(10, 12)) * 60 + Number(io.slice(12, 14)),
    };
    const list = byEmployee.get(m.employee_id) ?? [];
    list.push({ wall, tz: tzBySite.get(m.site_id) ?? DEFAULT_TZ });
    byEmployee.set(m.employee_id, list);
  }

  const now = new Date();
  for (const em of employments) {
    summary.employments++;
    const group = em.schedule_group && em.schedule_group.status === "active" ? em.schedule_group : null;
    const shifts = group ? (group.shifts as ShiftRow[]) : null;
    const t = thresholdsFor(group, company);
    const planFor = (ymd: string) => planForDate(shifts, ymd);

    const startYmd = ymdOf(em.start_date) > from ? ymdOf(em.start_date) : from;
    const endYmd = em.end_date && ymdOf(em.end_date) < last ? ymdOf(em.end_date) : last;
    const own = byEmployee.get(em.employee_id) ?? [];
    const tz = own[0]?.tz ?? DEFAULT_TZ;
    const perDay = assignMarksToDays(
      own.map((o) => o.wall),
      planFor
    );

    const kept: string[] = [];
    for (let ymd = startYmd; ymd <= endYmd; ymd = addDays(ymd, 1)) {
      const r = computeDay(planFor(ymd), perDay.get(ymd) ?? [], t);
      if (!r) continue;
      kept.push(ymd);
      const data = {
        employee_id: em.employee_id,
        shift_id: r.shiftId,
        first_in: r.firstIn != null ? toInstant(ymd, r.firstIn, tz) : null,
        last_out: r.lastOut != null ? toInstant(ymd, r.lastOut, tz) : null,
        worked_minutes: r.workedMinutes,
        overtime_minutes: r.overtimeMinutes,
        late_minutes: r.lateMinutes,
        early_leave_minutes: r.earlyLeaveMinutes,
        scheduled_minutes: r.scheduledMinutes,
        mark_count: r.markCount,
        status: r.status,
        computed_at: now,
      };
      const date = new Date(`${ymd}T00:00:00Z`);
      await prisma.attendance_day.upsert({
        where: { employment_id_date: { employment_id: em.id, date } },
        create: { employment_id: em.id, date, ...data },
        update: data,
      });
      summary.days++;
      summary.byStatus[r.status] = (summary.byStatus[r.status] ?? 0) + 1;
    }

    const stale = await prisma.attendance_day.deleteMany({
      where: {
        employment_id: em.id,
        date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${last}T00:00:00Z`) },
        NOT: { date: { in: kept.map((d) => new Date(`${d}T00:00:00Z`)) } },
      },
    });
    summary.removed += stale.count;
  }
  return summary;
}
