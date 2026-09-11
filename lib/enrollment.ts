// Fan-out de enrolamiento a nivel de grupo (Reunión 3, docs/09 §3.3 / §7.1 ítem 6).
// Al activar un contrato en una empresa de un grupo con `shared_employees`, la
// persona se enrola en TODOS los equipos del grupo (root + hijas) mediante una
// operación ADD_EMPLOYEE_TO_DEVICE por equipo. No es fatal: los fallos por
// equipo se acumulan y se reportan, no bloquean el alta del contrato.
import { prisma } from "@/lib/db";
import { startAddEmployeeToDevice } from "@/lib/operations";

export interface GroupFanOutResult {
  applied: boolean; // false si el grupo no comparte empleados
  started: number; // operaciones ADD_EMPLOYEE_TO_DEVICE encoladas
  skipped: number; // equipos donde la persona ya estaba enrolada
  notes: string[]; // fallos por equipo (no fatales)
}

const NOOP: GroupFanOutResult = { applied: false, started: 0, skipped: 0, notes: [] };

/** Fila "grupo" (root) de `companyId`: su padre, o ella misma si es raíz. */
async function resolveGroupRoot(companyId: number) {
  const c = await prisma.client_company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      shared_employees: true,
      parent: { select: { id: true, shared_employees: true } },
    },
  });
  if (!c) return null;
  return c.parent
    ? { id: c.parent.id, shared_employees: c.parent.shared_employees }
    : { id: c.id, shared_employees: c.shared_employees };
}

/** Todos los `company_id` del grupo: root + hijas. */
async function groupCompanyIds(rootId: number): Promise<number[]> {
  const children = await prisma.client_company.findMany({
    where: { parent_id: rootId },
    select: { id: true },
  });
  return [rootId, ...children.map((c) => c.id)];
}

/**
 * Encola ADD_EMPLOYEE_TO_DEVICE para `employeeId` en cada equipo del grupo de
 * `companyId` donde no tenga ya un enrolamiento activo. Si el grupo no tiene
 * `shared_employees`, no hace nada (`applied: false`).
 */
export async function fanOutEmployeeToGroup(
  employeeId: number,
  companyId: number
): Promise<GroupFanOutResult> {
  const root = await resolveGroupRoot(companyId);
  if (!root || !root.shared_employees) return NOOP;

  const companyIds = await groupCompanyIds(root.id);

  const [employee, devices, activeEnrollments] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { first_name: true, last_name: true },
    }),
    prisma.devices.findMany({
      where: { company_id: { in: companyIds } },
      select: { dev_id: true },
    }),
    prisma.employee_device_enrollment.findMany({
      where: { employee_id: employeeId, status: "active" },
      select: { dev_id: true },
    }),
  ]);
  if (!employee) return NOOP;

  const linked = new Set(activeEnrollments.map((e) => e.dev_id));
  const userName = `${employee.first_name} ${employee.last_name}`.trim();

  const result: GroupFanOutResult = { applied: true, started: 0, skipped: 0, notes: [] };
  for (const d of devices) {
    if (linked.has(d.dev_id)) {
      result.skipped++;
      continue;
    }
    try {
      await startAddEmployeeToDevice(d.dev_id, { employeeId, userName, privilege: "USER" });
      result.started++;
    } catch (e) {
      result.notes.push(`${d.dev_id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/** Sufijo para el mensaje de éxito del alta/traslado de contrato. */
export function fanOutNote(r: GroupFanOutResult): string {
  if (!r.applied || r.started === 0) return "";
  return ` Propagando a ${r.started} equipo(s) del grupo${
    r.notes.length ? ` (${r.notes.length} con aviso)` : ""
  }.`;
}
