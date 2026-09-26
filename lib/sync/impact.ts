// Vista previa de impacto (docs/10 R8 / §6): antes de guardar un cambio que
// reduce el alcance, mostrar "X pierde acceso a Y". Simula el alcance CON el
// cambio aplicado sobre una foto en memoria del estado — sin tocar la DB — con la
// misma regla que lib/scope.ts (R6):
//
//   equipos(empleado) = ⋃ contrato vigente c en empresa activa:
//     equipos de sedes activas de {c.empresa} ∪ (empresas activas del grupo si el
//     grupo está activo y comparte empleados)
//
// "Perder acceso" = estar hoy vinculado a un equipo (enrolamiento activo) que
// después del cambio queda fuera de su alcance. Los MANAGER/OPERATOR se marcan
// como protegidos: el reconciliador nunca los borra (R8).
import { prisma } from "@/lib/db";
import { activeEmploymentWhere } from "@/lib/scope";

export type ScopeChange =
  | { kind: "end_contract"; employmentId: number }
  | { kind: "transfer"; employmentId: number; toCompanyId: number }
  | { kind: "group_shared"; groupId: number; shared: boolean }
  | { kind: "group_status"; groupId: number; active: boolean }
  | { kind: "company_group"; companyId: number; groupId: number | null }
  | { kind: "company_status"; companyId: number; active: boolean }
  | { kind: "device_site"; devId: string; siteId: number | null };

interface World {
  contracts: Array<{ id: number; employeeId: number; companyId: number }>;
  companies: Map<number, { groupId: number | null; active: boolean }>;
  groups: Map<number, { active: boolean; shared: boolean }>;
  /** dev_id → empresa de su sede, solo si la sede está activa (sin sede / sede inactiva = sin empresa = congelado). */
  deviceCompany: Map<string, number | null>;
  siteCompany: Map<number, { companyId: number; active: boolean }>;
}

async function loadWorld(): Promise<World> {
  const [contracts, companies, groups, devices, sites] = await Promise.all([
    prisma.employment.findMany({ where: activeEmploymentWhere(), select: { id: true, employee_id: true, company_id: true } }),
    prisma.client_company.findMany({ select: { id: true, group_id: true, status: true } }),
    prisma.company_group.findMany({ select: { id: true, status: true, shared_employees: true } }),
    prisma.devices.findMany({ select: { dev_id: true, site: { select: { status: true, company_id: true } } } }),
    prisma.site.findMany({ select: { id: true, company_id: true, status: true } }),
  ]);
  return {
    contracts: contracts.map((c) => ({ id: c.id, employeeId: c.employee_id, companyId: c.company_id })),
    companies: new Map(companies.map((c) => [c.id, { groupId: c.group_id, active: c.status === "active" }])),
    groups: new Map(groups.map((g) => [g.id, { active: g.status === "active", shared: g.shared_employees }])),
    deviceCompany: new Map(devices.map((d) => [d.dev_id, d.site && d.site.status === "active" ? d.site.company_id : null])),
    siteCompany: new Map(sites.map((s) => [s.id, { companyId: s.company_id, active: s.status === "active" }])),
  };
}

function applyChange(w: World, ch: ScopeChange): World {
  const next: World = {
    contracts: [...w.contracts],
    companies: new Map(w.companies),
    groups: new Map(w.groups),
    deviceCompany: new Map(w.deviceCompany),
    siteCompany: w.siteCompany,
  };
  switch (ch.kind) {
    case "end_contract":
      next.contracts = next.contracts.filter((c) => c.id !== ch.employmentId);
      break;
    case "transfer":
      next.contracts = next.contracts.map((c) => (c.id === ch.employmentId ? { ...c, companyId: ch.toCompanyId } : c));
      break;
    case "group_shared": {
      const g = next.groups.get(ch.groupId);
      if (g) next.groups.set(ch.groupId, { ...g, shared: ch.shared });
      break;
    }
    case "group_status": {
      const g = next.groups.get(ch.groupId);
      if (g) next.groups.set(ch.groupId, { ...g, active: ch.active });
      break;
    }
    case "company_group": {
      const c = next.companies.get(ch.companyId);
      if (c) next.companies.set(ch.companyId, { ...c, groupId: ch.groupId });
      break;
    }
    case "company_status": {
      const c = next.companies.get(ch.companyId);
      if (c) next.companies.set(ch.companyId, { ...c, active: ch.active });
      break;
    }
    case "device_site": {
      const s = ch.siteId != null ? w.siteCompany.get(ch.siteId) : undefined;
      next.deviceCompany.set(ch.devId, s && s.active ? s.companyId : null);
      break;
    }
  }
  return next;
}

/** Empresas alcanzadas por un contrato en `companyId` (la regla de lib/scope.ts). */
function scopeCompanies(w: World, companyId: number): number[] {
  const c = w.companies.get(companyId);
  if (!c || !c.active) return [];
  const g = c.groupId != null ? w.groups.get(c.groupId) : undefined;
  if (!g || !g.active || !g.shared) return [companyId];
  return [...w.companies].filter(([, x]) => x.active && x.groupId === c.groupId).map(([id]) => id);
}

/** Alcance de cada empleado en esta foto del mundo: employee_id → equipos. */
export function scopeByEmployee(w: World): Map<number, Set<string>> {
  const devicesByCompany = new Map<number, string[]>();
  for (const [dev, company] of w.deviceCompany) {
    if (company == null) continue;
    devicesByCompany.set(company, [...(devicesByCompany.get(company) ?? []), dev]);
  }
  const out = new Map<number, Set<string>>();
  for (const c of w.contracts) {
    const set = out.get(c.employeeId) ?? new Set<string>();
    for (const company of scopeCompanies(w, c.companyId)) for (const d of devicesByCompany.get(company) ?? []) set.add(d);
    out.set(c.employeeId, set);
  }
  return out;
}

export interface ImpactResult {
  losses: Array<{ employeeId: number; name: string; cedula: string; devices: string[]; protectedDevices: string[] }>;
  gains: number; // personas que ganan al menos un equipo
  frozenDevices: string[]; // equipos que quedan sin sede activa → congelados (no se agrega ni se quita nada)
}

/**
 * Quién pierde acceso a qué equipos si se aplica `change`. Solo lectura. Nombres
 * de equipo ya resueltos para mostrar.
 */
export async function previewImpact(change: ScopeChange): Promise<ImpactResult> {
  const before = await loadWorld();
  const after = applyChange(before, change);
  const scopeBefore = scopeByEmployee(before);
  const scopeAfter = scopeByEmployee(after);

  const [links, deviceNames, cached] = await Promise.all([
    prisma.employee_device_enrollment.findMany({
      where: { status: "active" },
      select: { employee_id: true, dev_id: true, device_user_id: true },
    }),
    prisma.devices.findMany({ select: { dev_id: true, fk_name: true } }),
    prisma.users.findMany({ select: { dev_id: true, user_id: true, user_privilege: true } }),
  ]);
  const devName = new Map(deviceNames.map((d) => [d.dev_id, d.fk_name || d.dev_id]));
  const privilege = new Map(cached.map((u) => [`${u.dev_id}|${u.user_id}`, u.user_privilege]));

  // Un equipo congelado después del cambio no pierde a nadie (el reconciliador no lo toca).
  const frozenAfter = new Set([...after.deviceCompany].filter(([, c]) => c == null).map(([d]) => d));
  const frozenDevices = [...after.deviceCompany]
    .filter(([dev, c]) => c == null && before.deviceCompany.get(dev) != null)
    .map(([dev]) => devName.get(dev) ?? dev);

  const lossByEmployee = new Map<number, { devices: string[]; protectedDevices: string[] }>();
  for (const l of links) {
    if (frozenAfter.has(l.dev_id)) continue;
    if (scopeAfter.get(l.employee_id)?.has(l.dev_id)) continue;
    // Solo cuenta como pérdida si el cambio la causa (antes estaba en su alcance).
    if (!scopeBefore.get(l.employee_id)?.has(l.dev_id)) continue;
    const entry = lossByEmployee.get(l.employee_id) ?? { devices: [], protectedDevices: [] };
    const p = privilege.get(`${l.dev_id}|${l.device_user_id}`);
    (p === "MANAGER" || p === "OPERATOR" ? entry.protectedDevices : entry.devices).push(devName.get(l.dev_id) ?? l.dev_id);
    lossByEmployee.set(l.employee_id, entry);
  }

  let gains = 0;
  for (const [emp, set] of scopeAfter) {
    const prev = scopeBefore.get(emp) ?? new Set();
    if ([...set].some((d) => !prev.has(d))) gains++;
  }

  const employees = await prisma.employee.findMany({
    where: { id: { in: [...lossByEmployee.keys()] } },
    select: { id: true, first_name: true, last_name: true, national_id: true },
  });
  const losses = employees
    .map((e) => ({
      employeeId: e.id,
      name: `${e.first_name} ${e.last_name}`.trim(),
      cedula: e.national_id,
      ...lossByEmployee.get(e.id)!,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { losses, gains, frozenDevices };
}
