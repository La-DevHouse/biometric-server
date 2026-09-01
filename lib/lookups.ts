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
