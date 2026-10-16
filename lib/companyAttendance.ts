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
  /**
   * Solo para un export (docs/11 R10): marcaciones de IDs de equipo sin empleado
   * que, en esta consulta, cuentan como de esa persona. No se guarda nada.
   */
  assign?: DeviceUserAssignment[];
}

export interface DeviceUserAssignment {
  dev_id: string;
  user_id: string;
  employee_id: number;
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

/**
 * Ventana de repetidas (segundos): una marcación de la misma persona a menos de
 * esto de su marcación anterior — en CUALQUIER equipo de su alcance — no se
 * muestra ni se exporta. Cubre: la persona que marca dos veces para asegurarse,
 * la que marca en dos equipos de la misma sede, y la misma marcación guardada
 * bajo dos equipos (faciales con dev_id placeholder antes de la migración
 * 20261012120000, docs/04). Lo guardado en attendance_logs NO se toca: es solo
 * al leer, así que la regla se puede ajustar sin perder nada.
 * Una ráfaga encadenada (cada una a < ventana de la anterior) queda en su primera.
 * ATTENDANCE_DEDUP_SECONDS=0 la apaga.
 */
export function attendanceDedupSeconds(): number {
  const n = Number(process.env.ATTENDANCE_DEDUP_SECONDS ?? 180);
  return Number.isFinite(n) && n >= 0 ? n : 180;
}

/** io_time → timestamp, solo si tiene la forma YYYYMMDDhhmmss (uno raro no rompe la consulta). */
const IO_TS = (col: string) =>
  `CASE WHEN ${col} ~ '^[0-9]{14}$' THEN to_timestamp(${col}, 'YYYYMMDDHH24MISS') END`;

/** Filtros comunes (alcance, sede, rango) sobre `al` (attendance_logs) y `s` (site). */
function scopeConditions(companyIds: number[], f: CompanyAttendanceFilters) {
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
  return { conditions, args };
}

/** La consulta completa, con `kept` (false = repetida dentro de la ventana). */
async function attendanceQuery(companyId: number, f: CompanyAttendanceFilters) {
  const companyIds = await scopeCompanyIds(companyId);
  if (companyIds.length === 0) return null;
  const scope = scopeConditions(companyIds, f);
  const conditions = scope.conditions;
  const assign = f.assign ?? [];
  // Los parámetros van en el orden en que aparecen: primero la asignación (CTE asg).
  const args: unknown[] = [
    assign.map((a) => a.dev_id),
    assign.map((a) => a.user_id),
    assign.map((a) => a.employee_id),
    ...scope.args,
    companyId,
    attendanceDedupSeconds(),
  ];

  // Persona: por el employee_id ya resuelto, por la asignación de este export
  // (asg: ID viejo del equipo → persona, docs/11 R10) o por cédula = user_id
  // (docs/10 §4.6).
  // El contrato se mira con fechas, no con status: una baja siempre deja end_date.
  // DISTINCT ON (m.id): el cruce por dígitos de cédula puede dar dos personas
  // (V-123 y E-123); una marcación sale una sola vez.
  const sql = `WITH asg AS (
       SELECT DISTINCT ON (t.dev_id, t.user_id) t.dev_id, t.user_id, t.employee_id
         FROM unnest(?::text[], ?::text[], ?::int[]) AS t(dev_id, user_id, employee_id)
     ), marks AS (
       SELECT al.id, al.io_time, al.user_id,
              COALESCE(al.employee_id, a.employee_id, e.id) AS employee_id,
              s.id AS site_id, s.name AS site_name,
              COALESCE(NULLIF(d.name, ''), d.dev_id) AS device_name
         FROM attendance_logs al
         JOIN devices d ON d.dev_id = al.dev_id
         JOIN site s ON s.id = d.site_id
         LEFT JOIN asg a
           ON al.employee_id IS NULL AND a.dev_id = al.dev_id AND a.user_id = al.user_id
         LEFT JOIN employee e
           ON al.employee_id IS NULL AND a.employee_id IS NULL AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id
        WHERE al.io_time IS NOT NULL AND ${conditions.join(" AND ")}
     ), scoped AS (
       SELECT DISTINCT ON (m.id)
              m.id, m.io_time, m.user_id, m.employee_id,
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
        ORDER BY m.id, m.employee_id
     ), judged AS (
       SELECT sc.*,
              ${IO_TS("sc.io_time")} - lag(${IO_TS("sc.io_time")})
                OVER (PARTITION BY sc.employee_id ORDER BY sc.io_time, sc.id) AS since_prev
         FROM scoped sc
     ), flagged AS (
       SELECT j.*, (j.since_prev IS NULL OR j.since_prev >= make_interval(secs => ?)) AS kept
         FROM judged j
     )`;
  return { sql, args };
}

export async function companyAttendance(companyId: number, f: CompanyAttendanceFilters = {}) {
  const q = await attendanceQuery(companyId, f);
  if (!q) return [];
  const order = f.order === "asc" ? "ASC" : "DESC";
  const limit = f.limit != null ? `LIMIT ${Math.max(0, Math.floor(f.limit))}` : "";
  return allAsync<CompanyAttendanceRow>(
    `${q.sql}
     SELECT id, io_time, user_id, employee_id, first_name, last_name, national_id, site_id, site_name, device_name
       FROM flagged
      WHERE kept
      ORDER BY io_time ${order}, id ${order}
      ${limit}`,
    q.args
  );
}

/** Cuántas marcaciones oculta la ventana de repetidas con estos filtros (para avisarlo en pantalla). */
export async function companyAttendanceHiddenCount(companyId: number, f: CompanyAttendanceFilters = {}): Promise<number> {
  const q = await attendanceQuery(companyId, f);
  if (!q) return 0;
  const row = await allAsync<{ n: number }>(`${q.sql} SELECT COUNT(*)::int AS n FROM flagged WHERE NOT kept`, q.args);
  return Number(row[0]?.n ?? 0);
}

export interface UnmatchedDeviceUser {
  dev_id: string;
  device_name: string;
  site_name: string;
  user_id: string;
  /** Nombre que tiene en el equipo (caché `users`), si se leyó alguna vez. */
  user_name: string | null;
  marks: number;
  first_io_time: string;
  last_io_time: string;
}

/**
 * IDs de equipos del alcance con marcaciones en el rango que no son de ningún
 * empleado: ni resueltas ni con la cédula de alguien. Esas marcaciones no salen
 * en la asistencia ni en el export; el export avisa y deja asignarlas a una
 * persona solo para ese archivo (docs/11 R10).
 */
export async function companyUnmatchedDeviceUsers(
  companyId: number,
  f: CompanyAttendanceFilters = {}
): Promise<UnmatchedDeviceUser[]> {
  const companyIds = await scopeCompanyIds(companyId);
  if (companyIds.length === 0) return [];
  const { conditions, args } = scopeConditions(companyIds, f);
  const rows = await allAsync<UnmatchedDeviceUser>(
    `SELECT al.dev_id, COALESCE(NULLIF(d.name, ''), d.dev_id) AS device_name, s.name AS site_name,
            al.user_id, MAX(u.user_name) AS user_name, COUNT(*)::int AS marks,
            MIN(al.io_time) AS first_io_time, MAX(al.io_time) AS last_io_time
       FROM attendance_logs al
       JOIN devices d ON d.dev_id = al.dev_id
       JOIN site s ON s.id = d.site_id
       LEFT JOIN users u ON u.dev_id = al.dev_id AND u.user_id = al.user_id
      WHERE al.io_time IS NOT NULL AND al.employee_id IS NULL AND ${conditions.join(" AND ")}
        AND NOT EXISTS (SELECT 1 FROM employee e WHERE regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id)
      GROUP BY al.dev_id, d.name, d.dev_id, s.name, al.user_id
      ORDER BY COUNT(*) DESC, al.user_id`,
    args
  );
  return rows.map((r) => ({ ...r, marks: Number(r.marks) }));
}
