import { allAsync } from "@/lib/db";

/**
 * Buscador global (docs/11 S2/S4): solo objetos — empresas, grupos, sedes,
 * empleados, equipos, horarios y puestos. Insensible a mayúsculas y acentos
 * (sin la extensión `unaccent`: `translate()` sobre las vocales acentuadas del
 * español alcanza). Pocos resultados por tipo; a este volumen (~40 empresas,
 * miles de empleados) no hacen falta índices especiales.
 */

export type SearchKind = "empresa" | "grupo" | "sede" | "empleado" | "equipo" | "horario" | "puesto";

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Línea de contexto, ej. "V-12345678 · Farmacia X". */
  subtitle: string | null;
  href: string;
}

const PER_KIND = 5;
const ACCENTED = "áàäâéèëêíìïîóòöôúùüûñç";
const PLAIN = "aaaaeeeeiiiioooouuuunc";

/** Mismo criterio que el SQL: minúsculas y sin acentos. */
export function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Expresión SQL normalizada para una columna/expresión de texto. */
const n = (expr: string) => `translate(lower(COALESCE(${expr}, '')), '${ACCENTED}', '${PLAIN}')`;

export async function globalSearch(raw: string): Promise<SearchHit[]> {
  const q = normalize(raw.trim()).slice(0, 80);
  if (q.length < 2) return [];
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const digits = q.replace(/\D/g, "");
  // Buscar por cédula/serie solo con al menos 3 dígitos, para no traer todo con "1".
  const digitsLike = digits.length >= 3 ? `%${digits}%` : null;

  const [companies, groups, sites, employees, devices, schedules, positions] = await Promise.all([
    allAsync<{ id: number; name: string; tax_id: string | null; group_name: string | null; status: string }>(
      `SELECT c.id, c.name, c.tax_id, g.name AS group_name, c.status
         FROM client_company c LEFT JOIN company_group g ON g.id = c.group_id
        WHERE ${n("c.name")} LIKE ? OR ${n("c.tax_id")} LIKE ?
           OR (?::text IS NOT NULL AND regexp_replace(COALESCE(c.tax_id, ''), '\\D', '', 'g') LIKE ?)
        ORDER BY (c.status = 'active') DESC, c.name LIMIT ${PER_KIND}`,
      [like, like, digitsLike, digitsLike]
    ),
    allAsync<{ id: number; name: string; companies: number }>(
      `SELECT g.id, g.name, (SELECT COUNT(*) FROM client_company c WHERE c.group_id = g.id)::int AS companies
         FROM company_group g
        WHERE ${n("g.name")} LIKE ?
        ORDER BY g.name LIMIT ${PER_KIND}`,
      [like]
    ),
    allAsync<{ id: number; name: string; company_id: number; company_name: string }>(
      `SELECT s.id, s.name, s.company_id, c.name AS company_name
         FROM site s JOIN client_company c ON c.id = s.company_id
        WHERE ${n("s.name")} LIKE ?
        ORDER BY (s.status = 'active') DESC, c.name, s.name LIMIT ${PER_KIND}`,
      [like]
    ),
    allAsync<{ id: number; first_name: string; last_name: string; national_id: string; companies: string | null }>(
      `SELECT e.id, e.first_name, e.last_name, e.national_id,
              (SELECT string_agg(DISTINCT c.name, ', ')
                 FROM employment em JOIN client_company c ON c.id = em.company_id
                WHERE em.employee_id = e.id AND em.status = 'active') AS companies
         FROM employee e
        WHERE ${n("e.first_name || ' ' || e.last_name")} LIKE ?
           OR ${n("e.last_name || ' ' || e.first_name")} LIKE ?
           OR ${n("e.national_id")} LIKE ?
           OR (?::text IS NOT NULL AND regexp_replace(e.national_id, '\\D', '', 'g') LIKE ?)
        ORDER BY e.last_name, e.first_name LIMIT ${PER_KIND}`,
      [like, like, like, digitsLike, digitsLike]
    ),
    allAsync<{ dev_id: string; fk_name: string | null; company_name: string | null; site_name: string | null }>(
      `SELECT d.dev_id, d.fk_name, c.name AS company_name, s.name AS site_name
         FROM devices d
         LEFT JOIN site s ON s.id = d.site_id
         LEFT JOIN client_company c ON c.id = s.company_id
        WHERE ${n("d.fk_name")} LIKE ? OR ${n("d.dev_id")} LIKE ?
        ORDER BY d.fk_name NULLS LAST, d.dev_id LIMIT ${PER_KIND}`,
      [like, like]
    ),
    allAsync<{ id: number; name: string; company_name: string }>(
      `SELECT g.id, g.name, c.name AS company_name
         FROM schedule_group g JOIN client_company c ON c.id = g.company_id
        WHERE ${n("g.name")} LIKE ?
        ORDER BY (g.status = 'active') DESC, g.name LIMIT ${PER_KIND}`,
      [like]
    ),
    allAsync<{ id: number; name: string }>(
      `SELECT p.id, p.name FROM position p
        WHERE ${n("p.name")} LIKE ?
        ORDER BY (p.status = 'active') DESC, p.name LIMIT ${PER_KIND}`,
      [like]
    ),
  ]);

  const ctx = (...parts: Array<string | null | undefined>) => parts.filter(Boolean).join(" · ") || null;

  return [
    ...employees.map((e) => ({
      kind: "empleado" as const,
      id: String(e.id),
      title: `${e.first_name} ${e.last_name}`,
      subtitle: ctx(e.national_id, e.companies ?? "sin contrato vigente"),
      href: `/admin/empleados/${e.id}`,
    })),
    ...companies.map((c) => ({
      kind: "empresa" as const,
      id: String(c.id),
      title: c.name,
      subtitle: ctx(c.tax_id, c.group_name && `Grupo ${c.group_name}`, c.status !== "active" ? "inactiva" : null),
      href: `/admin/empresas/${c.id}`,
    })),
    ...devices.map((d) => ({
      kind: "equipo" as const,
      id: d.dev_id,
      title: d.fk_name || d.dev_id,
      subtitle: ctx(d.dev_id, d.company_name ? `${d.company_name} · ${d.site_name}` : "pendiente de asignar"),
      href: `/admin/dispositivos/${encodeURIComponent(d.dev_id)}`,
    })),
    ...sites.map((s) => ({
      kind: "sede" as const,
      id: String(s.id),
      title: s.name,
      subtitle: s.company_name,
      href: `/admin/empresas/${s.company_id}/sedes`,
    })),
    ...groups.map((g) => ({
      kind: "grupo" as const,
      id: String(g.id),
      title: g.name,
      subtitle: `${g.companies} ${g.companies === 1 ? "empresa" : "empresas"}`,
      // El grupo no tiene página: la lista de Empresas lo abre expandido.
      href: `/admin/empresas?grupo=${g.id}`,
    })),
    ...schedules.map((h) => ({
      kind: "horario" as const,
      id: String(h.id),
      title: h.name,
      subtitle: h.company_name,
      href: `/admin/horarios/${h.id}`,
    })),
    ...positions.map((p) => ({
      kind: "puesto" as const,
      id: String(p.id),
      title: p.name,
      subtitle: null,
      href: `/admin/categorias?tab=puestos`,
    })),
  ];
}
