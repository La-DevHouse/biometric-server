"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
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
  await requireUser();
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
  const user = await requireUser();
  return guarded(() => addMark(input, user.id));
}

export async function voidMarkAction(input: { employmentId: number; logId: number; reason: string }): Promise<ActionResult> {
  const user = await requireUser();
  return guarded(() => voidMark(input, user.id));
}

export async function revokeCorrectionAction(correctionId: number): Promise<ActionResult> {
  const user = await requireUser();
  return guarded(() => revokeCorrection(correctionId, user.id));
}
