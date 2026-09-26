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
