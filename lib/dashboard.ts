// Datos de Inicio (panel principal): cómo fue ayer, qué requiere atención, cada
// empresa y las últimas marcaciones. Todo filtrado por el alcance de la cuenta
// (`companyIds`, docs/18; null = todas). Lee los días que calcula el motor
// (attendance_day, docs/16) — ayer se calcula en la corrida nocturna.
import { prisma } from "@/lib/db";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { addDays } from "@/lib/attendance/compute";
import { isDeviceOnline } from "@/lib/deviceStatus";

export interface DayCounts {
  present: number;
  late: number;
  earlyLeave: number;
  absent: number;
  incomplete: number;
  /** Días calculados ese día (0 = todavía no se calculó). */
  total: number;
}

export interface CompanyYesterday extends DayCounts {
  id: number;
  name: string;
  contracts: number;
  withoutSchedule: number;
}

export interface DashboardDevice {
  devId: string;
  name: string;
  lastSeen: number | null;
  place: string | null;
}

export interface RecentMark {
  ioTime: string;
  person: string;
  employeeId: number | null;
  company: string | null;
  device: string;
}

export interface Dashboard {
  today: string;
  yesterday: string;
  /**
   * El día que se resume: el último día laborable ya calculado de la última semana
   * (un lunes, el viernes); si no hay ninguno, ayer.
   */
  summaryDay: string;
  devices: { total: number; online: number; offline: DashboardDevice[]; unassigned: number };
  marksToday: number;
  people: number;
  companies: number;
  day: DayCounts;
  perCompany: CompanyYesterday[];
  attention: {
    withoutSchedule: number;
    unmatchedIds: number;
    pendingHolds: number;
    corrections7d: number;
  };
  recent: RecentMark[];
}

const n = (v: unknown) => Number(v ?? 0);

export async function dashboard(companyIds: number[] | null): Promise<Dashboard> {
  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  const yesterday = addDays(today, -1);
  const last = await prisma.$queryRaw<{ d: Date | null }[]>`
    SELECT max(d.date) AS d
      FROM attendance_day d JOIN employment em ON em.id = d.employment_id
     WHERE d.date BETWEEN ${addDays(today, -7)}::date AND ${yesterday}::date
       AND d.status IN ('present', 'late', 'early_leave', 'absent', 'incomplete')
       AND (${companyIds}::int[] IS NULL OR em.company_id = ANY(${companyIds}::int[]))`;
  const dayYmd = last[0]?.d ? last[0].d.toISOString().slice(0, 10) : yesterday;
  const todayPrefix = today.replace(/-/g, "");
  const weekAgo = addDays(today, -7).replace(/-/g, "");
  const ids = companyIds;

  const [devices, companies, contracts, people, dayRows, marksToday, unmatched, holds, corrections, recent] = await Promise.all([
    // Equipos: los de las sedes del alcance; los sin sede solo para quien ve todas.
    prisma.devices.findMany({
      where: ids === null ? {} : { site: { company_id: { in: ids } } },
      select: { dev_id: true, name: true, last_seen_at: true, site_id: true, site: { select: { name: true, company: { select: { name: true } } } } },
    }),
    prisma.client_company.findMany({
      where: { status: "active", ...(ids === null ? {} : { id: { in: ids } }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Contratos vigentes hoy, por empresa, y cuántos sin horario.
    prisma.$queryRaw<{ company_id: number; contracts: number; without_schedule: number }[]>`
      SELECT em.company_id, count(*)::int AS contracts,
             count(*) FILTER (WHERE em.schedule_group_id IS NULL)::int AS without_schedule
        FROM employment em
       WHERE em.start_date <= ${today}::date AND (em.end_date IS NULL OR em.end_date >= ${today}::date)
         AND (${ids}::int[] IS NULL OR em.company_id = ANY(${ids}::int[]))
       GROUP BY em.company_id`,
    // Personas distintas (alguien con contrato en dos empresas cuenta una vez).
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT em.employee_id)::int AS n
        FROM employment em
       WHERE em.start_date <= ${today}::date AND (em.end_date IS NULL OR em.end_date >= ${today}::date)
         AND (${ids}::int[] IS NULL OR em.company_id = ANY(${ids}::int[]))`,
    // Ayer, por empresa y estado (una tardanza que además salió antes cuenta en las dos).
    prisma.$queryRaw<{ company_id: number; present: number; late: number; early: number; absent: number; incomplete: number; total: number }[]>`
      SELECT em.company_id,
             count(*) FILTER (WHERE d.status = 'present')::int AS present,
             count(d.late_minutes)::int AS late,
             count(d.early_leave_minutes)::int AS early,
             count(*) FILTER (WHERE d.status = 'absent')::int AS absent,
             count(*) FILTER (WHERE d.status = 'incomplete')::int AS incomplete,
             count(*)::int AS total
        FROM attendance_day d JOIN employment em ON em.id = d.employment_id
       WHERE d.date = ${dayYmd}::date
         AND (${ids}::int[] IS NULL OR em.company_id = ANY(${ids}::int[]))
       GROUP BY em.company_id`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM attendance_logs al
        LEFT JOIN devices d ON d.dev_id = al.dev_id
        LEFT JOIN site s ON s.id = d.site_id
       WHERE al.io_time LIKE ${todayPrefix + "%"}
         AND (${ids}::int[] IS NULL OR s.company_id = ANY(${ids}::int[]))`,
    // IDs de equipo con marcaciones en los últimos 7 días que no son de ningún empleado.
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT (al.dev_id, al.user_id))::int AS n
        FROM attendance_logs al
        JOIN devices d ON d.dev_id = al.dev_id
        JOIN site s ON s.id = d.site_id
       WHERE al.io_time >= ${weekAgo} AND al.employee_id IS NULL
         AND (${ids}::int[] IS NULL OR s.company_id = ANY(${ids}::int[]))
         AND NOT EXISTS (SELECT 1 FROM employee e WHERE regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id)`,
    ids === null ? prisma.sync_hold.count({ where: { resolved_at: null } }) : Promise.resolve(0),
    prisma.attendance_correction.count({
      where: {
        revoked_at: null,
        created_at: { gte: new Date(Date.now() - 7 * 86_400_000) },
        ...(ids === null ? {} : { employment: { company_id: { in: ids } } }),
      },
    }),
    // Últimas marcaciones, con la persona (por cédula) y la empresa del equipo.
    prisma.$queryRaw<{ io_time: string; user_id: string; employee_id: number | null; first_name: string | null; last_name: string | null; user_name: string | null; company: string | null; device: string }[]>`
      SELECT al.io_time, al.user_id, e.id AS employee_id, e.first_name, e.last_name, u.user_name,
             c.name AS company, COALESCE(NULLIF(d.name, ''), d.dev_id) AS device
        FROM attendance_logs al
        JOIN devices d ON d.dev_id = al.dev_id
        LEFT JOIN site s ON s.id = d.site_id
        LEFT JOIN client_company c ON c.id = s.company_id
        LEFT JOIN LATERAL (
          SELECT id, first_name, last_name FROM employee
           WHERE id = al.employee_id OR (al.employee_id IS NULL AND regexp_replace(national_id, '\\D', '', 'g') = al.user_id)
           LIMIT 1) e ON true
        LEFT JOIN users u ON u.dev_id = al.dev_id AND u.user_id = al.user_id
       WHERE (${ids}::int[] IS NULL OR s.company_id = ANY(${ids}::int[]))
       ORDER BY al.received_at DESC
       LIMIT 8`,
  ]);

  const byCompany = new Map(contracts.map((c) => [c.company_id, c]));
  const dayBy = new Map(dayRows.map((d) => [d.company_id, d]));
  const perCompany: CompanyYesterday[] = companies
    .map((c) => {
      const k = byCompany.get(c.id);
      const d = dayBy.get(c.id);
      return {
        id: c.id,
        name: c.name,
        contracts: n(k?.contracts),
        withoutSchedule: n(k?.without_schedule),
        present: n(d?.present),
        late: n(d?.late),
        earlyLeave: n(d?.early),
        absent: n(d?.absent),
        incomplete: n(d?.incomplete),
        total: n(d?.total),
      };
    })
    .filter((c) => c.contracts > 0 || c.total > 0)
    // Primero las que tuvieron más incidencias ayer.
    .sort((a, b) => b.absent + b.late + b.earlyLeave + b.incomplete - (a.absent + a.late + a.earlyLeave + a.incomplete) || a.name.localeCompare(b.name, "es"));

  const sum = (k: keyof DayCounts) => perCompany.reduce((t, c) => t + c[k], 0);
  const assigned = devices.filter((d) => d.site_id != null);
  const offline = assigned
    .filter((d) => !isDeviceOnline(d.last_seen_at == null ? null : Number(d.last_seen_at)))
    .map((d) => ({
      devId: d.dev_id,
      name: d.name || d.dev_id,
      lastSeen: d.last_seen_at == null ? null : Number(d.last_seen_at),
      place: d.site ? `${d.site.company.name} · ${d.site.name}` : null,
    }))
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0));

  return {
    today,
    yesterday,
    summaryDay: dayYmd,
    devices: {
      total: assigned.length,
      online: assigned.length - offline.length,
      offline,
      unassigned: devices.length - assigned.length,
    },
    marksToday: n(marksToday[0]?.n),
    people: n(people[0]?.n),
    companies: companies.length,
    day: {
      present: sum("present"),
      late: sum("late"),
      earlyLeave: sum("earlyLeave"),
      absent: sum("absent"),
      incomplete: sum("incomplete"),
      total: sum("total"),
    },
    perCompany,
    attention: {
      withoutSchedule: perCompany.reduce((t, c) => t + c.withoutSchedule, 0),
      unmatchedIds: n(unmatched[0]?.n),
      pendingHolds: holds,
      corrections7d: corrections,
    },
    recent: recent.map((r) => ({
      ioTime: r.io_time,
      person: r.first_name ? `${r.last_name}, ${r.first_name}` : r.user_name ? `${r.user_name} (ID ${r.user_id})` : `ID ${r.user_id}`,
      employeeId: r.employee_id,
      company: r.company,
      device: r.device,
    })),
  };
}
