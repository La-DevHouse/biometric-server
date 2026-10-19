// Consulta del registro de auditoría (audit_log) para la pantalla Auditoría
// (docs/07 §1.14, contrato: "registro de auditoría de acciones sensibles"). Lo
// escribe writeAudit (lib/audit.ts) en cada acción del panel; aquí solo se lee.
import { prisma } from "@/lib/db";

/** Qué hizo, en palabras. Una acción que no está aquí se muestra con su código. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  "company.create": "Creó la empresa",
  "company.update": "Editó la empresa",
  "company.deactivate": "Desactivó la empresa",
  "company.reactivate": "Reactivó la empresa",
  "group.create": "Creó el grupo",
  "group.update": "Editó el grupo",
  "group.deactivate": "Desactivó el grupo",
  "group.reactivate": "Reactivó el grupo",
  "site.create": "Creó la sede",
  "site.update": "Editó la sede",
  "site.deactivate": "Desactivó la sede",
  "site.reactivate": "Reactivó la sede",
  "employee.create": "Creó el empleado",
  "employee.update": "Editó el empleado",
  "employment.create": "Creó un contrato",
  "employment.update": "Editó un contrato",
  "employment.end": "Dio de baja un contrato",
  "employment.assign_schedule": "Asignó horario a varias personas",
  "schedule.create": "Creó el horario",
  "schedule.update": "Editó el horario",
  "schedule.deactivate": "Desactivó el horario",
  "schedule.reactivate": "Reactivó el horario",
  "shift.create": "Creó un turno",
  "shift.update": "Editó un turno",
  "shift.delete": "Eliminó un turno",
  "department.create": "Creó el departamento",
  "department.update": "Editó el departamento",
  "department.deactivate": "Desactivó el departamento",
  "department.reactivate": "Reactivó el departamento",
  "position.create": "Creó el cargo",
  "position.update": "Editó el cargo",
  "position.deactivate": "Desactivó el cargo",
  "position.reactivate": "Reactivó el cargo",
  "business_model.create": "Creó el modelo de negocio",
  "business_model.update": "Editó el modelo de negocio",
  "business_model.deactivate": "Desactivó el modelo de negocio",
  "business_model.reactivate": "Reactivó el modelo de negocio",
  "device.assign": "Asignó el equipo a una sede",
  "device.rename": "Cambió el nombre del equipo",
  "device.set_serial": "Corrigió el serial del equipo",
  "device_user.remove": "Borró un usuario del equipo",
  "device_user.gone": "Usuario borrado en el equipo",
  "sync.manual": "Sincronizó a mano",
  "import_run.delete": "Borró una importación",
  "attendance.export": "Exportó la asistencia a nómina",
  "attendance.report": "Descargó un reporte de asistencia",
  "attendance.compute": "Recalculó la asistencia",
  "attendance.correction.add_mark": "Agregó una marcación a mano",
  "attendance.correction.void_mark": "Anuló una marcación",
  "attendance.correction.revoke": "Deshizo una corrección",
  "app_user.create": "Creó la cuenta",
  "app_user.update": "Editó la cuenta",
  "app_user.deactivate": "Desactivó la cuenta",
  "app_user.reactivate": "Reactivó la cuenta",
  "app_user.reset_password": "Restableció la contraseña",
  "app_user.change_password": "Cambió su contraseña",
};

/** Áreas para el filtro: prefijos de `action`. */
export const AUDIT_AREAS: { value: string; label: string; prefixes: string[] }[] = [
  { value: "empresas", label: "Empresas, grupos y sedes", prefixes: ["company.", "group.", "site."] },
  { value: "empleados", label: "Empleados y contratos", prefixes: ["employee.", "employment."] },
  { value: "horarios", label: "Horarios y turnos", prefixes: ["schedule.", "shift."] },
  { value: "categorias", label: "Categorías", prefixes: ["department.", "position.", "business_model."] },
  { value: "equipos", label: "Equipos", prefixes: ["device.", "device_user.", "sync."] },
  { value: "asistencia", label: "Asistencia, correcciones y exportes", prefixes: ["attendance."] },
  { value: "cuentas", label: "Cuentas", prefixes: ["app_user."] },
  { value: "importaciones", label: "Importaciones", prefixes: ["import_run."] },
];

export const auditActionLabel = (action: string) => AUDIT_ACTION_LABEL[action] ?? action;

export interface AuditFilter {
  /** "YYYY-MM-DD", inclusive, hora de Caracas. */
  from?: string;
  to?: string;
  actorId?: number;
  area?: string;
  page?: number;
}

export const AUDIT_PAGE_SIZE = 100;

export interface AuditEntry {
  id: number;
  at: Date;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  /** Nombre actual de lo que se tocó (empresa, empleado, equipo…), si se puede resolver. */
  entityName: string | null;
  before: unknown;
  after: unknown;
}

/** Una página de entradas, la más reciente primero, y si hay más. */
export async function auditEntries(f: AuditFilter): Promise<{ entries: AuditEntry[]; hasMore: boolean }> {
  const area = AUDIT_AREAS.find((a) => a.value === f.area);
  const page = Math.max(1, f.page ?? 1);
  const rows = await prisma.audit_log.findMany({
    where: {
      ...(f.actorId ? { actor_app_user_id: f.actorId } : {}),
      ...(area ? { OR: area.prefixes.map((p) => ({ action: { startsWith: p } })) } : {}),
      created_at: {
        ...(f.from ? { gte: new Date(`${f.from}T00:00:00-04:00`) } : {}),
        ...(f.to ? { lt: new Date(new Date(`${f.to}T00:00:00-04:00`).getTime() + 86_400_000) } : {}),
      },
    },
    orderBy: [{ created_at: "desc" }, { id: "desc" }],
    skip: (page - 1) * AUDIT_PAGE_SIZE,
    take: AUDIT_PAGE_SIZE + 1,
    select: {
      id: true,
      created_at: true,
      action: true,
      entity_type: true,
      entity_id: true,
      before_json: true,
      after_json: true,
      actor: { select: { name: true } },
    },
  });
  const page_ = rows.slice(0, AUDIT_PAGE_SIZE);
  const names = await entityNames(page_.map((r) => ({ type: r.entity_type, id: r.entity_id })));
  return {
    hasMore: rows.length > AUDIT_PAGE_SIZE,
    entries: page_.map((r) => ({
      id: r.id,
      at: r.created_at,
      actor: r.actor?.name ?? null,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      entityName: names.get(`${r.entity_type}:${r.entity_id}`) ?? null,
      before: r.before_json,
      after: r.after_json,
    })),
  };
}

/** Nombres actuales de lo auditado, en una consulta por tipo. */
async function entityNames(refs: { type: string; id: string | null }[]): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(refs.filter((r) => r.type === type && r.id && /^\d+$/.test(r.id)).map((r) => Number(r.id)))];
  const out = new Map<string, string>();
  const put = (type: string, rows: { id: number | string; name: string | null }[]) => {
    for (const x of rows) if (x.name) out.set(`${type}:${x.id}`, x.name);
  };
  const devIds = [...new Set(refs.filter((r) => r.type === "devices" && r.id).map((r) => r.id!))];
  const [companies, groups, sites, employees, schedules, users, devices] = await Promise.all([
    prisma.client_company.findMany({ where: { id: { in: ids("client_company") } }, select: { id: true, name: true } }),
    prisma.company_group.findMany({ where: { id: { in: ids("company_group") } }, select: { id: true, name: true } }),
    prisma.site.findMany({ where: { id: { in: ids("site") } }, select: { id: true, name: true, company: { select: { name: true } } } }),
    prisma.employee.findMany({ where: { id: { in: ids("employee") } }, select: { id: true, first_name: true, last_name: true } }),
    prisma.schedule_group.findMany({ where: { id: { in: ids("schedule_group") } }, select: { id: true, name: true } }),
    prisma.app_user.findMany({ where: { id: { in: ids("app_user") } }, select: { id: true, name: true } }),
    prisma.devices.findMany({ where: { dev_id: { in: devIds } }, select: { dev_id: true, name: true } }),
  ]);
  put("client_company", companies);
  put("company_group", groups);
  put("site", sites.map((s) => ({ id: s.id, name: `${s.name} (${s.company.name})` })));
  put("employee", employees.map((e) => ({ id: e.id, name: `${e.last_name}, ${e.first_name}` })));
  put("schedule_group", schedules);
  put("app_user", users);
  put("devices", devices.map((d) => ({ id: d.dev_id, name: d.name || d.dev_id })));
  return out;
}

/** Campos que no aportan al leer un cambio. */
const NOISE = new Set([
  "id",
  "updated_at",
  "created_at",
  "password_hash",
  "computed_at",
  // Quién lo hizo ya está en la columna Usuario.
  "actor_app_user_id",
  "revoked_by_app_user_id",
]);

/** Valores de enum en palabras. */
const VALUE_LABEL: Record<string, string> = {
  add_mark: "agregar marcación",
  void_mark: "anular marcación",
  active: "activo",
  inactive: "inactivo",
  admin: "administrador",
  quincenal: "quincenal",
  semanal: "semanal",
  galepso_xlsx: "Excel para Galepso",
};

/** Nombres de campo frecuentes, en palabras; el resto se muestra con su código. */
const FIELD_LABEL: Record<string, string> = {
  name: "nombre",
  first_name: "nombres",
  last_name: "apellidos",
  national_id: "cédula",
  tax_id: "RIF",
  email: "email",
  status: "estado",
  role: "rol",
  start_date: "inicio",
  end_date: "fin",
  from: "desde",
  to: "hasta",
  rows: "filas",
  report: "reporte",
  reason: "motivo",
  io_time: "hora",
  kind: "tipo",
  site_id: "sede",
  company_id: "empresa",
  schedule_group_id: "horario",
  position_id: "cargo",
  department_id: "departamento",
  payroll_ref: "ref. nómina",
  payroll_type: "tipo de nómina",
  starts_on: "vigente desde",
  days: "días",
  removed: "borrados",
  timezone: "zona horaria",
  address: "dirección",
  phone: "teléfono",
  start_time: "entrada",
  end_time: "salida",
  workdays: "días laborables",
  revoked_at: "deshecha el",
  format: "formato",
  assigned: "asignadas",
  employee_id: "persona",
  employment_id: "contrato",
  attendance_log_id: "marcación",
  shared_employees: "comparte empleados",
  group_id: "grupo",
  business_model_id: "modelo de negocio",
  all_companies: "todas las empresas",
  company_ids: "empresas",
};

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function show(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string") {
    if (VALUE_LABEL[v]) return VALUE_LABEL[v];
    // Fechas de Prisma ("2026-10-19T00:00:00.000Z") o del formulario ("2026-10-19") → "19/10/2026".
    const m = /^(\d{4})-(\d{2})-(\d{2})(T00:00:00(\.000)?Z)?$/.exec(v);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
    // Instantes → fecha y hora de Caracas.
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !Number.isNaN(Date.parse(v))) {
      return new Date(v).toLocaleString("es-VE", { timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
    }
    // io_time de una marcación ("20261014170000") → "14/10/2026 17:00".
    const io = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\d{2}$/.exec(v);
    if (io) return `${io[3]}/${io[2]}/${io[1]} ${io[4]}:${io[5]}`;
    return v.length > 60 ? `${v.slice(0, 57)}…` : v;
  }
  if (typeof v === "boolean") return v ? "sí" : "no";
  if (typeof v === "number") return String(v);
  const s = JSON.stringify(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

/**
 * Qué cambió, en una línea por campo: "name: Viejo → Nuevo". Solo cuando hay antes y
 * después como objetos; si no, los campos del que haya (alta o baja). Sin ruido
 * (fechas de sistema, hash de contraseña).
 */
export function auditChanges(before: unknown, after: unknown, max = 6): { field: string; text: string }[] {
  const out: { field: string; text: string }[] = [];
  if (isPlain(before) && isPlain(after)) {
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      // Objetos anidados (p. ej. el contrato incluido en una corrección) no son cambios de campo.
      if (NOISE.has(k) || isPlain(before[k]) || isPlain(after[k])) continue;
      if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
      out.push({ field: FIELD_LABEL[k] ?? k, text: `${show(before[k])} → ${show(after[k])}` });
    }
  } else {
    const one = isPlain(after) ? after : isPlain(before) ? before : null;
    if (one)
      for (const [k, v] of Object.entries(one))
        if (!NOISE.has(k) && !isPlain(v) && v != null && v !== "" && !(Array.isArray(v) && v.length === 0)) out.push({ field: FIELD_LABEL[k] ?? k, text: show(v) });
  }
  return out.slice(0, max);
}

/** Enlace a lo que se tocó, si tiene página propia. */
export function auditEntityHref(entityType: string, entityId: string | null): string | null {
  if (!entityId) return null;
  switch (entityType) {
    case "client_company":
      return `/admin/empresas/${entityId}`;
    case "employee":
      return `/admin/empleados/${entityId}`;
    case "devices":
      return `/admin/dispositivos/${encodeURIComponent(entityId)}`;
    case "schedule_group":
      return `/admin/horarios/${entityId}`;
    default:
      return null;
  }
}

export const AUDIT_ENTITY_LABEL: Record<string, string> = {
  client_company: "Empresa",
  company_group: "Grupo",
  site: "Sede",
  employee: "Empleado",
  employment: "Contrato",
  schedule_group: "Horario",
  shift: "Turno",
  department: "Departamento",
  position: "Cargo",
  business_model: "Modelo de negocio",
  devices: "Equipo",
  app_user: "Cuenta",
  attendance_correction: "Corrección",
  export_run: "Exportación",
  import_run: "Importación",
  sync_hold: "Sincronización",
};
