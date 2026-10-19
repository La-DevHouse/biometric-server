"use server";

import { prisma } from "@/lib/db";
import { userErrorMessage } from "@/lib/serverErrors";
import { companyUnmatchedDeviceUsers, type UnmatchedDeviceUser } from "@/lib/companyAttendance";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";
import { computeCompanyAttendance, defaultComputeRange } from "@/lib/attendance/engine";
import { statusCount } from "@/lib/attendance/labels";
import type { DayStatus } from "@/lib/attendance/compute";
import { allow } from "@/lib/access";

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
  const g = await allow({ company: companyId });
  if (!g.ok) return { ok: false, error: g.error };
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

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/**
 * "Recalcular asistencia" (docs/16): calcula los días de la empresa en el rango
 * filtrado, o en los últimos días cerrados si no hay filtro. Lo mismo que hace el
 * worker cada noche; sirve para no esperar.
 */
export async function recomputeAttendanceAction(
  companyId: number,
  range: { from?: string; to?: string }
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const g = await allow({ edit: true, company: companyId });
  if (!g.ok) return { ok: false, error: g.error };
  const user = g.access.user;
  const def = defaultComputeRange();
  const from = range.from && YMD.test(range.from) ? range.from : def.from;
  const to = range.to && YMD.test(range.to) ? range.to : def.to;
  if (from > to) return { ok: false, error: "La fecha desde no puede ser posterior a la fecha hasta." };
  const days = (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000;
  if (days > 366) return { ok: false, error: "El rango no puede pasar de 366 días." };
  try {
    const r = await computeCompanyAttendance(companyId, from, to);
    await writeAudit({
      actorId: user.id,
      action: "attendance.compute",
      entityType: "client_company",
      entityId: companyId,
      after: { from, to, days: r.days, removed: r.removed, by_status: r.byStatus },
    });
    revalidatePath(`/admin/empresas/${companyId}/asistencia`);
    if (r.days === 0) {
      return { ok: true, message: `No hay días para calcular del ${fmtYmd(from)} al ${fmtYmd(to)} (el día de hoy se calcula mañana).` };
    }
    const parts = (Object.entries(r.byStatus) as [DayStatus, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([st, n]) => statusCount(st, n));
    return {
      ok: true,
      message: `Asistencia calculada del ${fmtYmd(from)} al ${fmtYmd(to)}: ${r.days} día(s) de ${r.employments} contrato(s) — ${parts.join(", ")}.`,
    };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}
