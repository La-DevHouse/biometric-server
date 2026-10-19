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

interface DayRow {
  employmentId: number;
  employeeId: number;
  date: string;
  shiftId: number | null;
  firstIn: Date | null;
  lastOut: Date | null;
  worked: number | null;
  overtime: number | null;
  late: number | null;
  early: number | null;
  scheduled: number | null;
  markCount: number;
  status: DayStatus;
}

/** Filas por sentencia: una empresa grande en 35 días son miles de días. */
const SAVE_BATCH = 2000;

/**
 * Guarda en lote (unnest + ON CONFLICT por contrato y fecha), no una consulta por
 * día: el cálculo nocturno recorre todas las empresas.
 */
async function saveDays(rows: DayRow[]): Promise<void> {
  for (let i = 0; i < rows.length; i += SAVE_BATCH) {
    const b = rows.slice(i, i + SAVE_BATCH);
    await prisma.$executeRaw`
      INSERT INTO attendance_day
        (employment_id, employee_id, date, shift_id, first_in, last_out, worked_minutes, overtime_minutes,
         late_minutes, early_leave_minutes, scheduled_minutes, mark_count, status, computed_at, updated_at)
      SELECT t.employment_id, t.employee_id, t.date, t.shift_id, t.first_in, t.last_out, t.worked, t.overtime,
             t.late, t.early, t.scheduled, t.mark_count, t.status::attendance_status, now(), now()
        FROM unnest(
          ${b.map((r) => r.employmentId)}::int[], ${b.map((r) => r.employeeId)}::int[], ${b.map((r) => r.date)}::date[],
          ${b.map((r) => r.shiftId)}::int[], ${b.map((r) => r.firstIn)}::timestamptz[], ${b.map((r) => r.lastOut)}::timestamptz[],
          ${b.map((r) => r.worked)}::int[], ${b.map((r) => r.overtime)}::int[], ${b.map((r) => r.late)}::int[],
          ${b.map((r) => r.early)}::int[], ${b.map((r) => r.scheduled)}::int[], ${b.map((r) => r.markCount)}::int[],
          ${b.map((r) => r.status)}::text[]
        ) AS t(employment_id, employee_id, date, shift_id, first_in, last_out, worked, overtime,
               late, early, scheduled, mark_count, status)
      ON CONFLICT (employment_id, date) DO UPDATE SET
        employee_id = EXCLUDED.employee_id, shift_id = EXCLUDED.shift_id,
        first_in = EXCLUDED.first_in, last_out = EXCLUDED.last_out,
        worked_minutes = EXCLUDED.worked_minutes, overtime_minutes = EXCLUDED.overtime_minutes,
        late_minutes = EXCLUDED.late_minutes, early_leave_minutes = EXCLUDED.early_leave_minutes,
        scheduled_minutes = EXCLUDED.scheduled_minutes, mark_count = EXCLUDED.mark_count,
        status = EXCLUDED.status, computed_at = now(), updated_at = now()`;
  }
}

/** Borra los días de esos contratos en [from, to] que esta corrida ya no produjo. */
async function removeStaleDays(employmentIds: number[], from: string, to: string, kept: DayRow[]): Promise<number> {
  if (employmentIds.length === 0) return 0;
  return prisma.$executeRaw`
    DELETE FROM attendance_day d
     WHERE d.employment_id = ANY(${employmentIds}::int[])
       AND d.date BETWEEN ${from}::date AND ${to}::date
       AND NOT EXISTS (
         SELECT 1 FROM unnest(${kept.map((r) => r.employmentId)}::int[], ${kept.map((r) => r.date)}::date[]) AS k(e, dt)
          WHERE k.e = d.employment_id AND k.dt = d.date)`;
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

  const rows: DayRow[] = [];
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

    for (let ymd = startYmd; ymd <= endYmd; ymd = addDays(ymd, 1)) {
      const r = computeDay(planFor(ymd), perDay.get(ymd) ?? [], t);
      if (!r) continue;
      rows.push({
        employmentId: em.id,
        employeeId: em.employee_id,
        date: ymd,
        shiftId: r.shiftId,
        firstIn: r.firstIn != null ? toInstant(ymd, r.firstIn, tz) : null,
        lastOut: r.lastOut != null ? toInstant(ymd, r.lastOut, tz) : null,
        worked: r.workedMinutes,
        overtime: r.overtimeMinutes,
        late: r.lateMinutes,
        early: r.earlyLeaveMinutes,
        scheduled: r.scheduledMinutes,
        markCount: r.markCount,
        status: r.status,
      });
      summary.days++;
      summary.byStatus[r.status] = (summary.byStatus[r.status] ?? 0) + 1;
    }
  }

  await saveDays(rows);
  summary.removed = await removeStaleDays(
    employments.map((e) => e.id),
    from,
    last,
    rows
  );
  return summary;
}

/** Días hacia atrás que recalcula la corrida nocturna (marcaciones que llegan tarde de equipos sin red). */
export function computeWindowDays(): number {
  const n = Number(process.env.ATTENDANCE_COMPUTE_DAYS ?? 35);
  return Number.isInteger(n) && n >= 1 && n <= 366 ? n : 35;
}

/** El rango por defecto: los últimos N días cerrados (hasta ayer). */
export function defaultComputeRange(today = dateKeyInTz(new Date(), DEFAULT_TZ)): { from: string; to: string } {
  return { from: addDays(today, -computeWindowDays()), to: addDays(today, -1) };
}

/**
 * Corrida nocturna (worker): todas las empresas activas, últimos N días. Una
 * empresa que falla no frena a las demás.
 */
export async function computeAllCompanies(): Promise<{ companies: number; days: number; failed: number }> {
  const { from, to } = defaultComputeRange();
  const companies = await prisma.client_company.findMany({ where: { status: "active" }, select: { id: true, name: true } });
  let days = 0;
  let failed = 0;
  for (const c of companies) {
    try {
      days += (await computeCompanyAttendance(c.id, from, to)).days;
    } catch (err) {
      failed++;
      console.error(`[asistencia] no se pudo calcular ${c.name} (${c.id}):`, err);
    }
  }
  return { companies: companies.length, days, failed };
}
