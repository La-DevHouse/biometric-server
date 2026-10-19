"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { writeAudit } from "@/lib/audit";
import { userErrorMessage } from "@/lib/serverErrors";
import { activeEmploymentWhere } from "@/lib/scope";
import { computeCompanyAttendance, defaultComputeRange } from "@/lib/attendance/engine";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { allow } from "@/lib/access";

/** Lo más atrás que se puede fechar un cambio de horario (y recalcular). */
const MAX_BACKDATE_DAYS = 366;

/**
 * Asignar (o quitar, con null) un horario a varios contratos vigentes de la empresa
 * a la vez, vigente desde `startsOn` (docs/16): los días anteriores conservan el
 * horario que tenían. Si el contrato empezó después, cuenta desde su inicio. Después
 * recalcula la asistencia desde esa fecha (o de los últimos días cerrados, lo que
 * sea más atrás), para que el cambio se vea enseguida en "Por día".
 */
export async function assignScheduleAction(
  companyId: number,
  scheduleGroupId: number | null,
  employmentIds: number[],
  startsOn: string
): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const g = await allow({ edit: true, company: companyId });
  if (!g.ok) return { ok: false, error: g.error };
  const user = g.access.user;
  if (employmentIds.length === 0) return { ok: false, error: "Seleccione al menos una persona." };
  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || Number.isNaN(Date.parse(`${startsOn}T00:00:00Z`))) {
    return { ok: false, error: "Indique la fecha desde la que rige el horario." };
  }
  if (startsOn > today) return { ok: false, error: "La fecha no puede ser futura." };
  const oldest = new Date(Date.parse(`${today}T00:00:00Z`) - MAX_BACKDATE_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (startsOn < oldest) return { ok: false, error: "La fecha no puede ser de hace más de un año." };
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
      select: { id: true, schedule_group_id: true, start_date: true },
    });
    if (valid.length !== new Set(employmentIds).size) {
      return { ok: false, error: "Algunos contratos no son vigentes en esta empresa. Recargue la página." };
    }
    // El historial primero, con su fecha; el trigger de employment ve que el último
    // registro ya es el horario nuevo y no agrega otro "desde hoy".
    await prisma.$transaction(async (tx) => {
      for (const v of valid) {
        const startYmd = v.start_date.toISOString().slice(0, 10);
        const d = new Date(`${startsOn > startYmd ? startsOn : startYmd}T00:00:00Z`);
        await tx.employment_schedule.deleteMany({ where: { employment_id: v.id, starts_on: { gte: d } } });
        await tx.employment_schedule.create({ data: { employment_id: v.id, schedule_group_id: scheduleGroupId, starts_on: d } });
      }
      await tx.employment.updateMany({
        where: { id: { in: valid.map((v) => v.id) } },
        data: { schedule_group_id: scheduleGroupId },
      });
    });
    await writeAudit({
      actorId: user.id,
      action: "employment.assign_schedule",
      entityType: "client_company",
      entityId: companyId,
      before: valid.map((v) => ({ employment_id: v.id, schedule_group_id: v.schedule_group_id })),
      after: { schedule_group_id: scheduleGroupId, starts_on: startsOn, employment_ids: valid.map((v) => v.id) },
    });

    const { from, to } = defaultComputeRange();
    await computeCompanyAttendance(companyId, startsOn < from ? startsOn : from, to);
    revalidatePath(`/admin/empresas/${companyId}/empleados`);
    revalidatePath(`/admin/empresas/${companyId}/asistencia`);
    const verb = scheduleGroupId == null ? "Horario quitado a" : "Horario asignado a";
    const since = startsOn.split("-").reverse().join("/");
    return { ok: true, message: `${verb} ${valid.length} persona(s) desde el ${since}. La asistencia ya se recalculó.` };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}
