// Listas de opciones para los formularios de contrato (empresa/horario/depto/puesto).
import { prisma } from "@/lib/db";

export async function loadEmploymentLookups() {
  const [companies, schedules, departments, positionsRaw] = await Promise.all([
    // El modelo de negocio es el de la empresa — ya no se hereda del grupo (docs/10 §2).
    prisma.client_company.findMany({
      where: { status: "active" },
      select: { id: true, name: true, business_model_id: true },
      orderBy: { name: "asc" },
    }),
    prisma.schedule_group.findMany({
      where: { status: "active" },
      select: { id: true, name: true, company_id: true },
      orderBy: { name: "asc" },
    }),
    prisma.department.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.position.findMany({
      where: { status: "active" },
      select: { id: true, name: true, business_models: { select: { business_model_id: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const positions = positionsRaw.map((p) => ({
    id: p.id,
    name: p.name,
    // vacío = cargo genérico (aplica a todos los modelos de negocio)
    business_model_ids: p.business_models.map((x) => x.business_model_id),
  }));

  return { companies, schedules, departments, positions };
}

export type EmploymentLookups = Awaited<ReturnType<typeof loadEmploymentLookups>>;

export interface DeviceCandidate {
  devId: string;
  label: string;
}

/**
 * Equipos candidatos para "agregar empleado a dispositivo" (uso manual). El
 * fan-out automático por alcance (lib/enrollment.ts) ya cubre el caso normal —
 * este selector es para la excepción: un equipo de otra empresa o de otro
 * grupo (Reunión 3, docs/09 D3: "no seleccionable en el flujo normal", o sea
 * el flujo manual es justo para lo que el fan-out no alcanza). Por eso
 * muestra equipos de **cualquier** empresa, no solo la(s) del empleo activo
 * de la persona. Excluye equipos donde ya tiene un enrolamiento activo.
 */
export async function loadDeviceCandidatesForEmployee(employeeId: number): Promise<DeviceCandidate[]> {
  const [devices, activeEnrollments] = await Promise.all([
    prisma.devices.findMany({
      select: {
        dev_id: true,
        fk_name: true,
        site: { select: { name: true, company: { select: { name: true } } } },
      },
      orderBy: { dev_id: "asc" },
    }),
    prisma.employee_device_enrollment.findMany({
      where: { employee_id: employeeId, status: "active" },
      select: { dev_id: true },
    }),
  ]);

  const alreadyLinked = new Set(activeEnrollments.map((e) => e.dev_id));
  return devices
    .filter((d) => !alreadyLinked.has(d.dev_id))
    .map((d) => {
      const place = [d.site?.company.name, d.site?.name].filter(Boolean).join(" — ");
      return {
        devId: d.dev_id,
        label: `${d.fk_name || d.dev_id}${place ? ` — ${place}` : ""}`,
      };
    });
}
