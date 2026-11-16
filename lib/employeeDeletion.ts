// Eliminar a una persona (solo administradores, docs/18). Solo si no tiene ningún
// contrato abierto: ni vigente ni por empezar, con ninguna empresa. Se borra la
// persona con sus contratos cerrados y lo que cuelga de ellos (días de asistencia,
// correcciones, historial de horario) y sus huellas guardadas, todo por CASCADE.
// Las marcaciones de los equipos se conservan, sin persona: son el archivo de lo
// que marcó cada equipo, y la auditoría guarda una copia de sus datos.
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";

/** Contrato abierto: sin cerrar y sin fecha de baja pasada, haya empezado o no. */
export function openEmploymentWhere(now: Date = new Date()): Prisma.employmentWhereInput {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  return { status: "active", OR: [{ end_date: null }, { end_date: { gte: today } }] };
}

export interface EmployeeDeletionInfo {
  /** Empresas con contrato abierto: si hay alguna, no se puede eliminar. */
  openWith: string[];
  closedContracts: number;
  attendanceDays: number;
  corrections: number;
  fingerprints: number;
  /** Se conservan, sin persona. */
  marks: number;
  /** Equipos donde sigue registrada según la última lectura (quedaría como un ID sin empleado). */
  devices: string[];
}

export async function employeeDeletionInfo(employeeId: number): Promise<EmployeeDeletionInfo | null> {
  const person = await prisma.employee.findUnique({ where: { id: employeeId }, select: { national_id: true } });
  if (!person) return null;
  const digits = person.national_id.replace(/\D/g, "");
  const [open, closedContracts, attendanceDays, corrections, fingerprints, marks, devices] = await Promise.all([
    prisma.employment.findMany({
      where: { employee_id: employeeId, ...openEmploymentWhere() },
      select: { company: { select: { name: true } } },
    }),
    prisma.employment.count({ where: { employee_id: employeeId } }),
    prisma.attendance_day.count({ where: { employee_id: employeeId } }),
    prisma.attendance_correction.count({ where: { employment: { employee_id: employeeId } } }),
    prisma.employee_fingerprint.count({ where: { employee_id: employeeId } }),
    prisma.attendance_logs.count({ where: { employee_id: employeeId } }),
    prisma.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT COALESCE(NULLIF(d.name, ''), d.dev_id) AS name
        FROM users u JOIN devices d ON d.dev_id = u.dev_id
       WHERE u.user_id = ${digits}
       ORDER BY 1`,
  ]);
  return {
    openWith: [...new Set(open.map((o) => o.company.name))],
    closedContracts,
    attendanceDays,
    corrections,
    fingerprints,
    marks,
    devices: devices.map((d) => d.name),
  };
}

export type DeleteEmployeeResult = { ok: true; message: string } | { ok: false; error: string };

export async function deleteEmployee(employeeId: number, actorId: number | null): Promise<DeleteEmployeeResult> {
  const before = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, national_id: true, tax_id: true, first_name: true, last_name: true, birth_date: true, status: true },
  });
  if (!before) return { ok: false, error: "La persona no existe." };
  const info = await employeeDeletionInfo(employeeId);

  let contracts: unknown[];
  try {
    contracts = await prisma.$transaction(async (tx) => {
      // Se revisa dentro de la transacción: alguien pudo cargarle un contrato mientras tanto.
      const open = await tx.employment.findMany({
        where: { employee_id: employeeId, ...openEmploymentWhere() },
        select: { company: { select: { name: true } } },
      });
      if (open.length > 0) {
        throw new OpenContract([...new Set(open.map((o) => o.company.name))]);
      }
      const closed = await tx.employment.findMany({ where: { employee_id: employeeId } });
      await tx.employment.deleteMany({ where: { employee_id: employeeId } });
      await tx.employee.delete({ where: { id: employeeId } });
      return closed;
    });
  } catch (e) {
    if (e instanceof OpenContract) {
      return { ok: false, error: `No se puede eliminar: tiene contrato vigente con ${e.companies.join(", ")}. Primero dele de baja.` };
    }
    throw e;
  }
  // Fuera de la transacción: writeAudit usa su propia conexión. La copia de los datos
  // de la persona y de sus contratos queda en la auditoría.
  await writeAudit({
    actorId,
    action: "employee.delete",
    entityType: "employee",
    entityId: employeeId,
    before: { ...before, contracts, counts: info && { ...info, devices: undefined } },
  });
  return { ok: true, message: `${before.first_name} ${before.last_name} fue eliminado/a.` };
}

class OpenContract extends Error {
  constructor(readonly companies: string[]) {
    super("contrato abierto");
  }
}
