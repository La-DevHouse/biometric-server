"use server";

import { revalidatePath } from "next/cache";
import { allow } from "@/lib/access";
import { prisma } from "@/lib/db";
import { userErrorMessage } from "@/lib/serverErrors";
import { addMark, dayMarks, revokeCorrection, voidMark, type CorrectionResult, type DayMarks } from "@/lib/attendance/corrections";

// Correcciones manuales de marcaciones (docs/16 paso 4). Se usan desde "Por día"
// de la empresa y desde Empleado → Asistencia; la lógica está en lib/attendance/corrections.

type ActionResult = { ok: true } | { ok: false; error: string };

function done(r: CorrectionResult): ActionResult {
  if (!r.ok) return r;
  revalidatePath(`/admin/empleados/${r.employeeId}/asistencia`);
  revalidatePath(`/admin/empresas/${r.companyId}/asistencia`);
  return { ok: true };
}

async function guarded(fn: () => Promise<CorrectionResult>): Promise<ActionResult> {
  try {
    return done(await fn());
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}

export async function dayMarksAction(employmentId: number, ymd: string): Promise<DayMarks | null> {
  if (!(await allow({ employment: employmentId })).ok) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return dayMarks(employmentId, ymd);
}

export async function addMarkAction(input: {
  employmentId: number;
  ymd: string;
  time: string;
  nextDay: boolean;
  siteId: number;
  reason: string;
}): Promise<ActionResult> {
  const g = await allow({ edit: true, employment: input.employmentId });
  if (!g.ok) return g;
  return guarded(() => addMark(input, g.access.user.id));
}

export async function voidMarkAction(input: { employmentId: number; logId: number; reason: string }): Promise<ActionResult> {
  const g = await allow({ edit: true, employment: input.employmentId });
  if (!g.ok) return g;
  return guarded(() => voidMark(input, g.access.user.id));
}

export async function revokeCorrectionAction(correctionId: number): Promise<ActionResult> {
  const c = await prisma.attendance_correction.findUnique({ where: { id: correctionId }, select: { employment_id: true } });
  const g = await allow({ edit: true, employment: c?.employment_id ?? null });
  if (!g.ok) return g;
  return guarded(() => revokeCorrection(correctionId, g.access.user.id));
}
