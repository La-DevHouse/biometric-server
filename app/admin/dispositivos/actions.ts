"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}

/**
 * Asigna un dispositivo a una sede (docs/10 R3): la empresa sale de la sede, no
 * se guarda aparte. Sin sede = "pendiente de asignar" — el equipo queda fuera
 * del alcance de todos (congelado para el fan-out y el reconciliador). La sede
 * tiene que estar activa y ser de una empresa activa.
 */
export async function assignDeviceAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const dev_id = str(fd, "dev_id");
  if (!dev_id) return { status: "error", error: "Dispositivo inválido." };

  const siteRaw = str(fd, "site_id");
  const site_id = siteRaw === "" ? null : Number(siteRaw);
  const device_admin_note = str(fd, "device_admin_note") || null;

  const device = await prisma.devices.findUnique({
    where: { dev_id },
    select: { dev_id: true, site_id: true },
  });
  if (!device) return { status: "error", error: "El dispositivo no existe." };

  if (site_id != null) {
    if (!Number.isFinite(site_id)) return { status: "error", error: "Sede inválida." };
    const site = await prisma.site.findUnique({
      where: { id: site_id },
      select: { status: true, company: { select: { status: true } } },
    });
    if (!site) return { status: "error", error: "La sede seleccionada no existe." };
    if (site.status !== "active" || site.company.status !== "active")
      return { status: "error", error: "La sede (o su empresa) está inactiva." };
  }

  // Timestamp de "desde cuándo" está en esta sede (docs/09 §3.13 / AI 7): se
  // refresca solo cuando la sede realmente cambia; re-guardar la misma no
  // reinicia la fecha. Al desasignar, se limpia.
  const linkChanged = site_id !== device.site_id;
  const company_linked_at = site_id == null ? null : linkChanged ? new Date() : undefined;

  await prisma.devices.update({
    where: { dev_id },
    data: { site_id, device_admin_note, company_linked_at },
  });
  await writeAudit({
    actorId: user.id,
    action: "device.assign",
    entityType: "devices",
    entityId: dev_id,
    before: { site_id: device.site_id },
    after: { site_id },
  });
  revalidatePath(`/admin/dispositivos/${dev_id}`);
  revalidatePath("/admin/enrolamiento");
  return {
    status: "ok",
    message: site_id == null ? "Dispositivo sin sede: queda pendiente de asignar." : "Dispositivo asignado.",
  };
}
