"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}

/**
 * Vincula un slot `(dev_id, device_user_id)` de un equipo con un empleado.
 * El unique parcial `ux_enrollment_active_slot` garantiza un solo vínculo
 * activo por slot; acá se valida antes para dar un mensaje claro.
 */
export async function assignEnrollmentAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const dev_id = str(fd, "dev_id");
  const device_user_id = str(fd, "device_user_id");
  const employee_id = Number(str(fd, "employee_id"));

  if (!dev_id || !device_user_id) return { status: "error", error: "Falta el equipo o el slot." };
  if (!Number.isFinite(employee_id)) return { status: "error", error: "Seleccioná un empleado." };

  const device = await prisma.devices.findUnique({ where: { dev_id } });
  if (!device) return { status: "error", error: "El equipo no existe." };
  const employee = await prisma.employee.findUnique({ where: { id: employee_id } });
  if (!employee) return { status: "error", error: "La persona no existe." };

  const existing = await prisma.employee_device_enrollment.findFirst({
    where: { dev_id, device_user_id, status: "active" },
  });
  if (existing)
    return {
      status: "error",
      error: `El slot ${device_user_id} de este equipo ya tiene un empleado vinculado. Desvinculalo primero.`,
    };

  try {
    const created = await prisma.employee_device_enrollment.create({
      data: { employee_id, dev_id, device_user_id, status: "active" },
    });
    await writeAudit({
      actorId: user.id,
      action: "enrollment.create",
      entityType: "employee_device_enrollment",
      entityId: created.id,
      after: created,
    });
    revalidatePath("/admin/enrolamiento");
    revalidatePath(`/admin/empleados/${employee_id}`);
    return {
      status: "ok",
      message: `${employee.first_name} ${employee.last_name} vinculado/a al slot ${device_user_id}.`,
    };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `El slot ${device_user_id} ya tiene un empleado vinculado.` };
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Cierra un vínculo activo (soft): status=inactive + ended_at. */
export async function endEnrollmentAction(
  id: number
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.employee_device_enrollment.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "El vínculo no existe." };
  if (before.status !== "active") return { ok: false, error: "El vínculo ya está cerrado." };

  await prisma.employee_device_enrollment.update({
    where: { id },
    data: { status: "inactive", ended_at: new Date() },
  });
  await writeAudit({
    actorId: user.id,
    action: "enrollment.end",
    entityType: "employee_device_enrollment",
    entityId: id,
    before: { status: before.status, employee_id: before.employee_id, device_user_id: before.device_user_id },
    after: { status: "inactive" },
  });
  revalidatePath("/admin/enrolamiento");
  revalidatePath(`/admin/empleados/${before.employee_id}`);
  return { ok: true };
}
