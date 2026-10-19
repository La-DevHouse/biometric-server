// Lectura de los días calculados por el motor (docs/16) para las pantallas.
import { prisma } from "@/lib/db";
import type { DayStatus } from "./compute";

export interface AttendanceDayRow {
  id: number;
  /** "YYYY-MM-DD" */
  date: string;
  employmentId: number;
  employeeId: number;
  employeeName: string;
  nationalId: string;
  companyId: number;
  companyName: string;
  scheduleName: string | null;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number | null;
  overtimeMinutes: number | null;
  lateMinutes: number | null;
  earlyLeaveMinutes: number | null;
  scheduledMinutes: number | null;
  markCount: number;
  status: DayStatus | null;
}

export interface DaysFilter {
  /** "YYYY-MM-DD", inclusive */
  from: string;
  to: string;
  status?: DayStatus | null;
  limit?: number;
}

async function readDays(where: Record<string, unknown>, f: DaysFilter): Promise<AttendanceDayRow[]> {
  const rows = await prisma.attendance_day.findMany({
    where: {
      ...where,
      date: { gte: new Date(`${f.from}T00:00:00Z`), lte: new Date(`${f.to}T00:00:00Z`) },
      ...(f.status ? { status: f.status } : {}),
    },
    orderBy: [{ date: "desc" }, { employee: { last_name: "asc" } }, { employee: { first_name: "asc" } }],
    take: f.limit,
    select: {
      id: true,
      date: true,
      employment_id: true,
      employee_id: true,
      first_in: true,
      last_out: true,
      worked_minutes: true,
      overtime_minutes: true,
      late_minutes: true,
      early_leave_minutes: true,
      scheduled_minutes: true,
      mark_count: true,
      status: true,
      employee: { select: { first_name: true, last_name: true, national_id: true } },
      employment: {
        select: { company_id: true, company: { select: { name: true } }, schedule_group: { select: { name: true } } },
      },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    date: r.date.toISOString().slice(0, 10),
    employmentId: r.employment_id,
    employeeId: r.employee_id,
    employeeName: `${r.employee.last_name}, ${r.employee.first_name}`,
    nationalId: r.employee.national_id,
    companyId: r.employment.company_id,
    companyName: r.employment.company.name,
    scheduleName: r.employment.schedule_group?.name ?? null,
    firstIn: r.first_in,
    lastOut: r.last_out,
    workedMinutes: r.worked_minutes,
    overtimeMinutes: r.overtime_minutes,
    lateMinutes: r.late_minutes,
    earlyLeaveMinutes: r.early_leave_minutes,
    scheduledMinutes: r.scheduled_minutes,
    markCount: r.mark_count,
    status: (r.status as DayStatus | null) ?? null,
  }));
}

/** Días de los contratos de una empresa (Empresa → Asistencia → Por día). */
export function companyAttendanceDays(companyId: number, f: DaysFilter) {
  return readDays({ employment: { company_id: companyId } }, f);
}

/** Días de una persona, en todas sus empresas (Empleado → Asistencia). */
export function employeeAttendanceDays(employeeId: number, f: DaysFilter) {
  return readDays({ employee_id: employeeId }, f);
}

/** Cuántos días hay en cada estado, para el resumen de arriba de la tabla. */
export async function companyAttendanceDayCounts(companyId: number, from: string, to: string) {
  const rows = await prisma.attendance_day.groupBy({
    by: ["status"],
    where: {
      employment: { company_id: companyId },
      date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
    },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.status as DayStatus | null, r._count._all]));
}
