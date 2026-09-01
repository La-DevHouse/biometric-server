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
 * Asigna un dispositivo a una empresa (y opcionalmente a una sede). Sin empresa
 * no puede haber sede. La sede debe pertenecer a la empresa elegida.
 */
export async function assignDeviceAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const dev_id = str(fd, "dev_id");
  if (!dev_id) return { status: "error", error: "Dispositivo inválido." };

  const companyRaw = str(fd, "company_id");
  const siteRaw = str(fd, "site_id");
  const company_id = companyRaw === "" ? null : Number(companyRaw);
  let site_id = siteRaw === "" ? null : Number(siteRaw);
  const device_admin_note = str(fd, "device_admin_note") || null;

  const device = await prisma.devices.findUnique({
    where: { dev_id },
    select: { dev_id: true, company_id: true, site_id: true },
  });
  if (!device) return { status: "error", error: "El dispositivo no existe." };

  if (company_id != null) {
    const company = await prisma.client_company.findUnique({
      where: { id: company_id },
      select: { id: true },
    });
    if (!company) return { status: "error", error: "La empresa seleccionada no existe." };
  } else {
    site_id = null; // sin empresa no hay sede
  }

  if (site_id != null) {
    const site = await prisma.site.findUnique({
      where: { id: site_id },
      select: { id: true, company_id: true },
    });
    if (!site) return { status: "error", error: "La sede seleccionada no existe." };
    if (site.company_id !== company_id)
      return { status: "error", error: "La sede no pertenece a la empresa elegida." };
  }

  await prisma.devices.update({
    where: { dev_id },
    data: { company_id, site_id, device_admin_note },
  });
  await writeAudit({
    actorId: user.id,
    action: "device.assign",
    entityType: "devices",
    entityId: dev_id,
    before: { company_id: device.company_id, site_id: device.site_id },
    after: { company_id, site_id },
  });
  revalidatePath(`/admin/dispositivos/${dev_id}`);
  revalidatePath("/admin/enrolamiento");
  return {
    status: "ok",
    message: company_id == null ? "Dispositivo sin empresa asignada." : "Dispositivo asignado.",
  };
}
