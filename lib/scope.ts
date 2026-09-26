// Alcance de la huella de un empleado (docs/10-reestructura-dominio-sync.md §4.1, R6).
//
//   Dispositivos_aplicables(empleado) =
//     ⋃ por cada contrato activo c:
//         empresas = {c.empresa} ∪ (empresas activas del grupo de c.empresa, si el grupo
//                                   existe, está activo y tiene shared_employees)
//         dispositivos de todas las sedes activas de esas empresas
//
// Solo lectura — lo usan el reconciliador (lib/sync/reconcile.ts) y la vista
// previa de impacto de la UI (docs/10 §4.2, R8).
// Un equipo sin sede nunca está en el alcance de nadie (congelado, docs/10 §3.3).
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

/** Contrato vigente hoy: activo, ya empezado y sin terminar. */
export function activeEmploymentWhere(now: Date = new Date()): Prisma.employmentWhereInput {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return {
    status: "active",
    start_date: { lte: today },
    OR: [{ end_date: null }, { end_date: { gte: today } }],
  };
}

/**
 * Empresas cuyas sedes alcanza un contrato en `companyId`: la propia empresa,
 * más las demás empresas activas de su grupo si el grupo comparte empleados.
 */
export async function scopeCompanyIds(companyId: number): Promise<number[]> {
  const c = await prisma.client_company.findUnique({
    where: { id: companyId },
    select: { id: true, group: { select: { id: true, status: true, shared_employees: true } } },
  });
  if (!c) return [];
  const g = c.group;
  if (!g || g.status !== "active" || !g.shared_employees) return [c.id];
  const siblings = await prisma.client_company.findMany({
    where: { group_id: g.id, status: "active" },
    select: { id: true },
  });
  return [...new Set([c.id, ...siblings.map((s) => s.id)])];
}

/** dev_id de todos los equipos en sedes activas de estas empresas. */
async function devicesOfCompanies(companyIds: number[]): Promise<string[]> {
  if (companyIds.length === 0) return [];
  const rows = await prisma.devices.findMany({
    where: { site: { status: "active", company_id: { in: companyIds } } },
    select: { dev_id: true },
  });
  return rows.map((r) => r.dev_id);
}

/** Equipos donde este empleado debería existir hoy (unión sobre sus contratos vigentes). */
export async function applicableDevices(employeeId: number): Promise<string[]> {
  const contracts = await prisma.employment.findMany({
    where: { employee_id: employeeId, ...activeEmploymentWhere() },
    select: { company_id: true, company: { select: { status: true } } },
  });
  const companyIds = new Set<number>();
  for (const c of contracts) {
    if (c.company.status !== "active") continue;
    for (const id of await scopeCompanyIds(c.company_id)) companyIds.add(id);
  }
  return devicesOfCompanies([...companyIds]);
}

/** Todos los equipos alcanzados por un contrato en esta empresa (ignora a la persona). */
export async function devicesInCompanyScope(companyId: number): Promise<string[]> {
  return devicesOfCompanies(await scopeCompanyIds(companyId));
}
