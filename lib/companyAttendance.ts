import { allAsync, prisma } from "@/lib/db";
import { scopeCompanyIds } from "@/lib/scope";
import { toDayBound } from "@/lib/ioTime";

/**
 * Asistencia de una empresa POR CONTRATO (docs/11 C4 / R3): las marcaciones de
 * las personas con contrato de trabajo en esta empresa, hechas en cualquier
 * equipo de su alcance (sedes propias y, si el grupo comparte empleados, las
 * del grupo), y solo las que caen DENTRO del período de un contrato con ella.
 * IDs que no son la cédula de un empleado no entran.
 *
 * Es lo que se ve en Empresa → Asistencia y exactamente lo que se exporta a
 * nómina (R8) — una sola consulta para las dos cosas, para que no diverjan.
 *
 * Limitación conocida: el alcance se mide con la sede ACTUAL de cada equipo
 * (no hay historial de asignaciones); mover un equipo de empresa cambia a qué
 * empresa se imputan sus marcaciones viejas.
 */

export interface CompanyAttendanceRow {
  id: number;
  io_time: string;
  user_id: string;
  employee_id: number;
  first_name: string;
  last_name: string;
  national_id: string;
  site_id: number;
  site_name: string;
  device_name: string;
}

export interface CompanyAttendanceFilters {
  /** "YYYY-MM-DD", inclusive. */
  from?: string;
  /** "YYYY-MM-DD", inclusive. */
  to?: string;
  siteId?: number | null;
  /** Sin límite si se omite (el export necesita todo). */
  limit?: number;
  order?: "asc" | "desc";
}

/** Sedes donde pueden marcar los empleados de esta empresa (para el filtro). */
export async function companyAttendanceSites(companyId: number) {
  const companyIds = await scopeCompanyIds(companyId);
  return prisma.site.findMany({
    where: { company_id: { in: companyIds } },
    select: { id: true, name: true, status: true, company_id: true, company: { select: { name: true } } },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
  });
}

export async function companyAttendance(companyId: number, f: CompanyAttendanceFilters = {}) {
  const companyIds = await scopeCompanyIds(companyId);
  if (companyIds.length === 0) return [];

  const conditions: string[] = [`s.company_id IN (${companyIds.map(() => "?").join(", ")})`];
  const args: unknown[] = [...companyIds];
  if (f.siteId != null) {
    conditions.push("s.id = ?");
    args.push(f.siteId);
  }
  if (f.from) {
    conditions.push("al.io_time >= ?");
    args.push(toDayBound(f.from, "start"));
  }
  if (f.to) {
    conditions.push("al.io_time <= ?");
    args.push(toDayBound(f.to, "end"));
  }
  args.push(companyId);

  const order = f.order === "asc" ? "ASC" : "DESC";
  const limit = f.limit != null ? `LIMIT ${Math.max(0, Math.floor(f.limit))}` : "";

  // Persona: por el employee_id ya resuelto, o por cédula = user_id (docs/10 §4.6).
  // El contrato se mira con fechas, no con status: una baja siempre deja end_date.
  return allAsync<CompanyAttendanceRow>(
    `WITH marks AS (
       SELECT al.id, al.io_time, al.user_id,
              COALESCE(al.employee_id, e.id) AS employee_id,
              s.id AS site_id, s.name AS site_name,
              COALESCE(d.fk_name, d.dev_id) AS device_name
         FROM attendance_logs al
         JOIN devices d ON d.dev_id = al.dev_id
         JOIN site s ON s.id = d.site_id
         LEFT JOIN employee e
           ON al.employee_id IS NULL AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id
        WHERE al.io_time IS NOT NULL AND ${conditions.join(" AND ")}
     )
     SELECT m.id, m.io_time, m.user_id, m.employee_id,
            p.first_name, p.last_name, p.national_id,
            m.site_id, m.site_name, m.device_name
       FROM marks m
       JOIN employee p ON p.id = m.employee_id
      WHERE EXISTS (
              SELECT 1 FROM employment em
               WHERE em.employee_id = m.employee_id
                 AND em.company_id = ?
                 AND to_date(substr(m.io_time, 1, 8), 'YYYYMMDD') >= em.start_date
                 AND (em.end_date IS NULL OR to_date(substr(m.io_time, 1, 8), 'YYYYMMDD') <= em.end_date)
            )
      ORDER BY m.io_time ${order}, m.id ${order}
      ${limit}`,
    args
  );
}
