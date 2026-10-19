"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { userErrorMessage } from "@/lib/serverErrors";
import { activeEmploymentWhere } from "@/lib/scope";
import { computeCompanyAttendance, defaultComputeRange } from "@/lib/attendance/engine";

/**
 * Asignar (o quitar, con null) un horario a varios contratos vigentes de la empresa
 * a la vez (docs/16). Después recalcula la asistencia de los últimos días cerrados,
 * para que el cambio se vea enseguida en "Por día".
 */
export async function assignScheduleAction(
  companyId: number,
  scheduleGroupId: number | null,
  employmentIds: number[]
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (employmentIds.length === 0) return { ok: false, error: "Seleccione al menos una persona." };
  try {
    if (scheduleGroupId != null) {
      const g = await prisma.schedule_group.findFirst({
        where: { id: scheduleGroupId, company_id: companyId, status: "active" },
        select: { id: true },
      });
      if (!g) return { ok: false, error: "Ese horario no es de esta empresa o está inactivo." };
    }
    const valid = await prisma.employment.findMany({
      where: { id: { in: employmentIds }, company_id: companyId, ...activeEmploymentWhere() },
      select: { id: true, schedule_group_id: true },
    });
    if (valid.length !== new Set(employmentIds).size) {
      return { ok: false, error: "Algunos contratos no son vigentes en esta empresa. Recargue la página." };
    }
    await prisma.employment.updateMany({
      where: { id: { in: valid.map((v) => v.id) } },
      data: { schedule_group_id: scheduleGroupId },
    });
    await writeAudit({
      actorId: user.id,
      action: "employment.assign_schedule",
      entityType: "client_company",
      entityId: companyId,
      before: valid.map((v) => ({ employment_id: v.id, schedule_group_id: v.schedule_group_id })),
      after: { schedule_group_id: scheduleGroupId, employment_ids: valid.map((v) => v.id) },
    });

    const { from, to } = defaultComputeRange();
    await computeCompanyAttendance(companyId, from, to);
    revalidatePath(`/admin/empresas/${companyId}/empleados`);
    revalidatePath(`/admin/empresas/${companyId}/asistencia`);
    const verb = scheduleGroupId == null ? "Horario quitado a" : "Horario asignado a";
    return { ok: true, message: `${verb} ${valid.length} persona(s). La asistencia de los últimos días ya se recalculó.` };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}
