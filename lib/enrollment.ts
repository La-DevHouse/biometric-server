// Fan-out de enrolamiento por alcance (docs/10-reestructura-dominio-sync.md R6 /
// §4.1). Al crear o trasladar un contrato, la persona se enrola en TODOS los
// equipos de su alcance — las sedes de la empresa del contrato, más las de las
// demás empresas del grupo si el grupo comparte empleados — mediante una
// operación ADD_EMPLOYEE_TO_DEVICE por equipo. No es fatal: los fallos por
// equipo se acumulan y se reportan, no bloquean el alta del contrato.
//
// Solo agrega. Sacar a alguien de los equipos que dejaron de aplicarle es
// trabajo del reconciliador (PR 2, con sus salvaguardas — docs/10 §4.5).
import { prisma } from "@/lib/db";
import { startAddEmployeeToDevice, startPushFingerprint } from "@/lib/operations";
import { applicableDevices } from "@/lib/scope";

export interface FanOutResult {
  applied: boolean; // false si no hay equipos en el alcance
  started: number; // operaciones ADD_EMPLOYEE_TO_DEVICE encoladas
  skipped: number; // equipos donde la persona ya estaba enrolada
  notes: string[]; // fallos por equipo (no fatales)
}

const NOOP: FanOutResult = { applied: false, started: 0, skipped: 0, notes: [] };

/**
 * Encola ADD_EMPLOYEE_TO_DEVICE para `employeeId` en cada equipo de su alcance
 * actual (unión sobre todos sus contratos vigentes) donde no tenga ya un
 * enrolamiento activo.
 */
export async function fanOutEmployeeToScope(employeeId: number): Promise<FanOutResult> {
  const [employee, devices, activeEnrollments] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { first_name: true, last_name: true },
    }),
    applicableDevices(employeeId),
    prisma.employee_device_enrollment.findMany({
      where: { employee_id: employeeId, status: "active" },
      select: { dev_id: true },
    }),
  ]);
  if (!employee || devices.length === 0) return NOOP;

  const linked = new Set(activeEnrollments.map((e) => e.dev_id));
  const userName = `${employee.first_name} ${employee.last_name}`.trim();

  const result: FanOutResult = { applied: true, started: 0, skipped: 0, notes: [] };
  for (const devId of devices) {
    if (linked.has(devId)) {
      result.skipped++;
      continue;
    }
    try {
      await startAddEmployeeToDevice(devId, { employeeId, userName, privilege: "USER" });
      result.started++;
    } catch (e) {
      result.notes.push(`${devId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

/**
 * Tras capturar una huella (CAPTURE_FINGERPRINT), la empuja sola a cualquier
 * otro enrolamiento activo de la misma persona que no sea el equipo de
 * origen — típicamente cuentas vacías que dejó el fan-out de alta al grupo
 * (arriba: crea el usuario en todos los equipos, pero nadie tiene huella
 * hasta que alguien la registra físicamente en uno y se captura). Sin esto,
 * había que copiarla a mano equipo por equipo. No fatal: los fallos por
 * equipo se acumulan y se reportan, igual que el fan-out de alta.
 */
export async function fanOutCapturedFingerprint(
  employeeId: number,
  sourceDevId: string,
  fingerIndexes: number[]
): Promise<FanOutResult> {
  if (fingerIndexes.length === 0) return NOOP;

  const siblings = await prisma.employee_device_enrollment.findMany({
    where: { employee_id: employeeId, status: "active", dev_id: { not: sourceDevId } },
    select: { dev_id: true },
  });
  if (siblings.length === 0) return NOOP;

  const result: FanOutResult = { applied: true, started: 0, skipped: 0, notes: [] };
  for (const sib of siblings) {
    for (const fingerIndex of fingerIndexes) {
      try {
        await startPushFingerprint(employeeId, fingerIndex, sib.dev_id);
        result.started++;
      } catch (e) {
        result.notes.push(`${sib.dev_id} (dedo ${fingerIndex}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return result;
}

/** Sufijo para el mensaje de éxito del alta/traslado de contrato. */
export function fanOutNote(r: FanOutResult): string {
  if (!r.applied || r.started === 0) return "";
  return ` Enrolando en ${r.started} equipo(s)${
    r.notes.length ? ` (${r.notes.length} con aviso)` : ""
  }.`;
}
