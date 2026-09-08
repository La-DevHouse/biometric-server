// Listas de opciones para los formularios de empleo (empresa/sede/grupo/depto/puesto).
import { prisma } from "@/lib/db";

export async function loadEmploymentLookups() {
  const [companies, sites, groups, departments, positions] = await Promise.all([
    prisma.client_company.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.site.findMany({
      where: { status: "active" },
      select: { id: true, name: true, company_id: true },
      orderBy: { name: "asc" },
    }),
    prisma.employee_group.findMany({
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
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { companies, sites, groups, departments, positions };
}

export type EmploymentLookups = Awaited<ReturnType<typeof loadEmploymentLookups>>;

export interface DeviceCandidate {
  devId: string;
  label: string;
}

/**
 * Equipos candidatos para "agregar empleado a dispositivo": los de la(s)
 * empresa(s) de sus empleos activos — decisión explícita: nunca automático
 * más allá de mostrar la lista. Excluye equipos donde la persona ya tiene
 * un enrolamiento activo.
 */
export async function loadDeviceCandidatesForEmployee(employeeId: number): Promise<DeviceCandidate[]> {
  const employments = await prisma.employment.findMany({
    where: { employee_id: employeeId, status: "active" },
    select: { company_id: true },
  });

  const companyIds = new Set(employments.map((em) => em.company_id));
  if (companyIds.size === 0) return [];

  const [devices, activeEnrollments] = await Promise.all([
    prisma.devices.findMany({
      where: { company_id: { in: [...companyIds] } },
      select: { dev_id: true, fk_name: true, company: { select: { name: true } } },
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
    .map((d) => ({
      devId: d.dev_id,
      label: `${d.fk_name || d.dev_id}${d.company ? ` — ${d.company.name}` : ""}`,
    }));
}
