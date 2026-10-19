// Reportes del período (Hito 5, docs/17): consolidado por contrato e incidencias.
// Leen los días que calculó el motor (attendance_day, docs/16) y las correcciones
// manuales vigentes; no recalculan nada. Lo que se ve en pantalla y lo que baja en
// .xlsx sale de estas mismas funciones.
import { prisma } from "@/lib/db";
import { addDays } from "./compute";

export interface SummaryRow {
  employmentId: number;
  employeeId: number;
  name: string;
  nationalId: string;
  payrollRef: string | null;
  scheduleName: string | null;
  /** Días que el horario esperaba trabajo (presente, tardanza, salida anticipada, ausente, incompleto). */
  workdays: number;
  /** Días con entrada y salida (incluye días libres trabajados y días sin horario). */
  daysWorked: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lates: number;
  lateMinutes: number;
  earlyLeaves: number;
  earlyLeaveMinutes: number;
  absences: number;
  incomplete: number;
  restDaysWorked: number;
  noScheduleDays: number;
  /** Correcciones manuales vigentes con marcaciones del período. */
  corrections: number;
}

const compact = (ymd: string) => ymd.replace(/-/g, "");

/**
 * Consolidado del período por contrato (insumo de nómina): todos los contratos de
 * la empresa vigentes en algún día de [from, to], aunque no tengan días calculados.
 */
export async function companySummary(companyId: number, from: string, to: string): Promise<SummaryRow[]> {
  const rows = await prisma.$queryRaw<
    {
      employment_id: number;
      employee_id: number;
      first_name: string;
      last_name: string;
      national_id: string;
      payroll_ref: string | null;
      schedule_name: string | null;
      workdays: number | null;
      days_worked: number | null;
      worked: number | null;
      overtime: number | null;
      lates: number | null;
      late_min: number | null;
      earlies: number | null;
      early_min: number | null;
      absences: number | null;
      incomplete: number | null;
      rest_worked: number | null;
      no_schedule: number | null;
      corrections: number | null;
    }[]
  >`
    WITH em AS (
      SELECT em.id, em.employee_id, em.payroll_ref, e.first_name, e.last_name, e.national_id, sg.name AS schedule_name
        FROM employment em
        JOIN employee e ON e.id = em.employee_id
        LEFT JOIN schedule_group sg ON sg.id = em.schedule_group_id
       WHERE em.company_id = ${companyId}
         AND em.start_date <= ${to}::date
         AND (em.end_date IS NULL OR em.end_date >= ${from}::date)
    ), d AS (
      SELECT employment_id,
             count(*) FILTER (WHERE status IN ('present', 'late', 'early_leave', 'absent', 'incomplete'))::int AS workdays,
             count(*) FILTER (WHERE worked_minutes > 0)::int AS days_worked,
             COALESCE(sum(worked_minutes), 0)::int AS worked,
             COALESCE(sum(overtime_minutes), 0)::int AS overtime,
             count(late_minutes)::int AS lates,
             COALESCE(sum(late_minutes), 0)::int AS late_min,
             count(early_leave_minutes)::int AS earlies,
             COALESCE(sum(early_leave_minutes), 0)::int AS early_min,
             count(*) FILTER (WHERE status = 'absent')::int AS absences,
             count(*) FILTER (WHERE status = 'incomplete')::int AS incomplete,
             count(*) FILTER (WHERE status = 'rest_day_worked')::int AS rest_worked,
             count(*) FILTER (WHERE status = 'no_schedule')::int AS no_schedule
        FROM attendance_day
       WHERE employment_id IN (SELECT id FROM em) AND date BETWEEN ${from}::date AND ${to}::date
       GROUP BY employment_id
    ), c AS (
      SELECT ac.employment_id, count(*)::int AS n
        FROM attendance_correction ac
        LEFT JOIN attendance_logs l ON l.id = ac.attendance_log_id
       WHERE ac.revoked_at IS NULL AND ac.employment_id IN (SELECT id FROM em)
         AND substr(COALESCE(ac.io_time, l.io_time), 1, 8) BETWEEN ${compact(from)} AND ${compact(to)}
       GROUP BY ac.employment_id
    )
    SELECT em.id AS employment_id, em.employee_id, em.first_name, em.last_name, em.national_id, em.payroll_ref, em.schedule_name,
           d.workdays, d.days_worked, d.worked, d.overtime, d.lates, d.late_min, d.earlies, d.early_min,
           d.absences, d.incomplete, d.rest_worked, d.no_schedule, c.n AS corrections
      FROM em
      LEFT JOIN d ON d.employment_id = em.id
      LEFT JOIN c ON c.employment_id = em.id
     ORDER BY em.last_name, em.first_name, em.id`;
  return rows.map((r) => ({
    employmentId: r.employment_id,
    employeeId: r.employee_id,
    name: `${r.last_name}, ${r.first_name}`,
    nationalId: r.national_id,
    payrollRef: r.payroll_ref,
    scheduleName: r.schedule_name,
    workdays: r.workdays ?? 0,
    daysWorked: r.days_worked ?? 0,
    workedMinutes: r.worked ?? 0,
    overtimeMinutes: r.overtime ?? 0,
    lates: r.lates ?? 0,
    lateMinutes: r.late_min ?? 0,
    earlyLeaves: r.earlies ?? 0,
    earlyLeaveMinutes: r.early_min ?? 0,
    absences: r.absences ?? 0,
    incomplete: r.incomplete ?? 0,
    restDaysWorked: r.rest_worked ?? 0,
    noScheduleDays: r.no_schedule ?? 0,
    corrections: r.corrections ?? 0,
  }));
}

export type IncidentKind = "late" | "early_leave" | "absent" | "incomplete" | "mark_added" | "mark_voided";

export const INCIDENT_LABEL: Record<IncidentKind, string> = {
  late: "Tardanza",
  early_leave: "Salida anticipada",
  absent: "Ausencia",
  incomplete: "Marcación incompleta",
  mark_added: "Marcación agregada a mano",
  mark_voided: "Marcación anulada a mano",
};

export interface IncidentRow {
  /** "YYYY-MM-DD" */
  date: string;
  kind: IncidentKind;
  employmentId: number;
  employeeId: number;
  name: string;
  nationalId: string;
  /** Minutos de tardanza o de salida anticipada. */
  minutes: number | null;
  /** "HH:MM" de la marcación (incompleta, agregada o anulada). */
  time: string | null;
  /** Correcciones: motivo, quién y cuándo. */
  reason: string | null;
  actor: string | null;
  at: Date | null;
}

const hm = (d: Date | null) =>
  d ? d.toLocaleTimeString("es-VE", { timeZone: "America/Caracas", hour: "2-digit", minute: "2-digit", hour12: false }) : null;

/**
 * Incidencias del período: tardanzas, salidas anticipadas, ausencias, días con una
 * sola marcación (de los días calculados) y las correcciones manuales vigentes.
 * Una tardanza que además salió antes son dos incidencias. Por fecha y persona.
 */
export async function companyIncidents(companyId: number, from: string, to: string): Promise<IncidentRow[]> {
  const days = await prisma.attendance_day.findMany({
    where: {
      employment: { company_id: companyId },
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      OR: [{ status: { in: ["absent", "incomplete"] } }, { late_minutes: { not: null } }, { early_leave_minutes: { not: null } }],
    },
    select: {
      date: true,
      status: true,
      late_minutes: true,
      early_leave_minutes: true,
      first_in: true,
      employment_id: true,
      employee_id: true,
      employee: { select: { first_name: true, last_name: true, national_id: true } },
    },
  });
  const out: IncidentRow[] = [];
  for (const d of days) {
    const base = {
      date: d.date.toISOString().slice(0, 10),
      employmentId: d.employment_id,
      employeeId: d.employee_id,
      name: `${d.employee.last_name}, ${d.employee.first_name}`,
      nationalId: d.employee.national_id,
      minutes: null,
      time: null,
      reason: null,
      actor: null,
      at: null,
    };
    if (d.late_minutes != null) out.push({ ...base, kind: "late", minutes: d.late_minutes });
    if (d.early_leave_minutes != null) out.push({ ...base, kind: "early_leave", minutes: d.early_leave_minutes });
    if (d.status === "absent") out.push({ ...base, kind: "absent" });
    if (d.status === "incomplete") out.push({ ...base, kind: "incomplete", time: hm(d.first_in) });
  }

  // Correcciones con marcaciones del período (la agregada por su hora; la anulada por la del equipo).
  const corrections = await prisma.$queryRaw<
    {
      kind: "add_mark" | "void_mark";
      io_time: string;
      reason: string;
      created_at: Date;
      actor: string;
      employment_id: number;
      employee_id: number;
      first_name: string;
      last_name: string;
      national_id: string;
    }[]
  >`
    SELECT ac.kind, COALESCE(ac.io_time, l.io_time) AS io_time, ac.reason, ac.created_at, u.name AS actor,
           em.id AS employment_id, em.employee_id, e.first_name, e.last_name, e.national_id
      FROM attendance_correction ac
      JOIN employment em ON em.id = ac.employment_id
      JOIN employee e ON e.id = em.employee_id
      JOIN app_user u ON u.id = ac.actor_app_user_id
      LEFT JOIN attendance_logs l ON l.id = ac.attendance_log_id
     WHERE em.company_id = ${companyId} AND ac.revoked_at IS NULL
       AND substr(COALESCE(ac.io_time, l.io_time), 1, 8) BETWEEN ${compact(from)} AND ${compact(to)}`;
  for (const c of corrections) {
    out.push({
      date: `${c.io_time.slice(0, 4)}-${c.io_time.slice(4, 6)}-${c.io_time.slice(6, 8)}`,
      kind: c.kind === "add_mark" ? "mark_added" : "mark_voided",
      employmentId: c.employment_id,
      employeeId: c.employee_id,
      name: `${c.last_name}, ${c.first_name}`,
      nationalId: c.national_id,
      minutes: null,
      time: `${c.io_time.slice(8, 10)}:${c.io_time.slice(10, 12)}`,
      reason: c.reason,
      actor: c.actor,
      at: c.created_at,
    });
  }
  const order = Object.keys(INCIDENT_LABEL);
  return out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.name.localeCompare(b.name, "es") ||
      order.indexOf(a.kind) - order.indexOf(b.kind) ||
      (a.time ?? "").localeCompare(b.time ?? "")
  );
}

export interface PeriodPreset {
  label: string;
  from: string;
  to: string;
}

/**
 * Períodos de nómina a un clic (quincenas y meses calendario). Un período que
 * todavía no terminó llega hasta ayer: el día de hoy se calcula mañana.
 */
export function periodPresets(today: string): PeriodPreset[] {
  const [y, m, d] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (yy: number, mm: number, dd: number) => `${yy}-${pad(mm)}-${pad(dd)}`;
  const lastDay = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const prevMonth = m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 };
  const yesterday = addDays(today, -1);
  const cap = (to: string) => (to < today ? to : yesterday);

  const firstHalf = { from: ymd(y, m, 1), to: ymd(y, m, 15) };
  const secondHalf = { from: ymd(y, m, 16), to: ymd(y, m, lastDay(y, m)) };
  const current = d <= 15 ? firstHalf : secondHalf;
  const previous =
    d <= 15
      ? { from: ymd(prevMonth.y, prevMonth.m, 16), to: ymd(prevMonth.y, prevMonth.m, lastDay(prevMonth.y, prevMonth.m)) }
      : firstHalf;
  const presets: PeriodPreset[] = [];
  if (current.from < today) presets.push({ label: "Quincena en curso", from: current.from, to: cap(current.to) });
  presets.push({ label: "Quincena anterior", ...previous });
  if (d > 1) presets.push({ label: "Mes en curso", from: ymd(y, m, 1), to: yesterday });
  presets.push({ label: "Mes anterior", from: ymd(prevMonth.y, prevMonth.m, 1), to: ymd(prevMonth.y, prevMonth.m, lastDay(prevMonth.y, prevMonth.m)) });
  return presets;
}
