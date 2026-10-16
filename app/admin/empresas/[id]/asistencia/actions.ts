"use server";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { userErrorMessage } from "@/lib/serverErrors";
import { companyUnmatchedDeviceUsers, type UnmatchedDeviceUser } from "@/lib/companyAttendance";

export interface ExportFilters {
  from: string;
  to: string;
  sede: number | null;
}

export interface EmployeeOption {
  value: string;
  label: string;
  hint: string;
}

/**
 * Antes de exportar (docs/11 R10): los IDs de equipo con marcaciones en el rango
 * que no son de ningún empleado. Si hay, el diálogo deja excluirlos o asignarlos
 * —solo para ese archivo— a una persona con contrato en la empresa.
 */
export async function exportPreflightAction(
  companyId: number,
  f: ExportFilters
): Promise<{ ok: true; unmatched: UnmatchedDeviceUser[]; employees: EmployeeOption[] } | { ok: false; error: string }> {
  await requireUser();
  try {
    const unmatched = await companyUnmatchedDeviceUsers(companyId, { from: f.from, to: f.to, siteId: f.sede });
    if (unmatched.length === 0) return { ok: true, unmatched, employees: [] };
    const people = await prisma.employee.findMany({
      where: { employments: { some: { company_id: companyId } } },
      select: { id: true, first_name: true, last_name: true, national_id: true },
      orderBy: [{ last_name: "asc" }, { first_name: "asc" }],
    });
    const employees = people.map((p) => ({ value: String(p.id), label: `${p.last_name}, ${p.first_name}`, hint: p.national_id }));
    return { ok: true, unmatched, employees };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}
