"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";
import { joinDoc } from "@/lib/documento";

const ABSENCE_RULES = ["no_check_in", "no_marks", "under_hours"] as const;
type AbsenceRule = (typeof ABSENCE_RULES)[number];

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

function nonNegInt(fd: FormData, key: string): number | null {
  const v = str(fd, key);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

function thresholdsFromForm(fd: FormData) {
  const ruleRaw = str(fd, "absence_rule");
  return {
    late_tolerance_min: nonNegInt(fd, "late_tolerance_min"),
    early_leave_tolerance_min: nonNegInt(fd, "early_leave_tolerance_min"),
    absence_rule: (ABSENCE_RULES as readonly string[]).includes(ruleRaw)
      ? (ruleRaw as AbsenceRule)
      : null,
    absence_min_hours: nonNegInt(fd, "absence_min_hours"),
  };
}

function fieldsFromForm(fd: FormData):
  | { fields: ReturnType<typeof buildFields> }
  | { error: string } {
  const rifPrefix = str(fd, "rif_prefix");
  const rifNumber = str(fd, "rif_number");
  let tax_id: string | null = null;
  if (rifPrefix || rifNumber) {
    const rif = joinDoc(rifPrefix, rifNumber, "rif");
    if ("error" in rif) return { error: rif.error };
    tax_id = rif.value;
  }
  return { fields: buildFields(fd, tax_id) };
}

function buildFields(fd: FormData, tax_id: string | null) {
  return {
    name: str(fd, "name"),
    tax_id,
    is_group: fd.get("is_group") === "on",
    shared_employees: fd.get("shared_employees") === "on",
    address: str(fd, "address") || null,
    parent_id: str(fd, "parent_id") === "" ? null : Number(str(fd, "parent_id")),
    ...thresholdsFromForm(fd),
  };
}

/** Valida el padre para la regla de 2 niveles. `selfId` en edición. */
async function checkParent(
  parentId: number | null,
  selfId: number | null
): Promise<string | null> {
  if (parentId == null) return null;
  if (selfId != null && parentId === selfId) return "Una empresa no puede ser su propio padre.";
  const parent = await prisma.client_company.findUnique({ where: { id: parentId } });
  if (!parent) return "La empresa padre seleccionada no existe.";
  if (parent.parent_id != null)
    return "Esa empresa ya es una empresa hija — la jerarquía es de 2 niveles (padre → hijas).";
  if (selfId != null) {
    const childCount = await prisma.client_company.count({ where: { parent_id: selfId } });
    if (childCount > 0)
      return "Esta empresa ya es padre de otras; no puede pasar a ser hija.";
  }
  return null;
}

export async function createCompanyAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const parsed = fieldsFromForm(fd);
  if ("error" in parsed) return { status: "error", error: parsed.error };
  const f = parsed.fields;

  if (!f.name) return { status: "error", error: "El nombre es obligatorio." };
  if (!f.is_group && !f.tax_id)
    return { status: "error", error: "El RIF es obligatorio para empresas operativas (no-grupo)." };
  const parentErr = await checkParent(f.parent_id, null);
  if (parentErr) return { status: "error", error: parentErr };

  try {
    const created = await prisma.client_company.create({ data: f });
    await writeAudit({
      actorId: user.id,
      action: "company.create",
      entityType: "client_company",
      entityId: created.id,
      after: created,
    });
    revalidatePath("/admin/empresas");
    return { status: "ok", message: `Empresa "${f.name}" creada.` };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateCompanyAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };

  const before = await prisma.client_company.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "La empresa no existe." };

  const parsed = fieldsFromForm(fd);
  if ("error" in parsed) return { status: "error", error: parsed.error };
  const f = parsed.fields;
  if (!f.name) return { status: "error", error: "El nombre es obligatorio." };
  if (!f.is_group && !f.tax_id)
    return { status: "error", error: "El RIF es obligatorio para empresas operativas (no-grupo)." };
  const parentErr = await checkParent(f.parent_id, id);
  if (parentErr) return { status: "error", error: parentErr };

  try {
    const updated = await prisma.client_company.update({ where: { id }, data: f });
    await writeAudit({
      actorId: user.id,
      action: "company.update",
      entityType: "client_company",
      entityId: id,
      before,
      after: updated,
    });
    revalidatePath("/admin/empresas");
    revalidatePath(`/admin/empresas/${id}`);
    return { status: "ok", message: "Cambios guardados." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setCompanyStatusAction(
  id: number,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.client_company.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "La empresa no existe." };

  await prisma.client_company.update({
    where: { id },
    data: { status: active ? "active" : "inactive" },
  });
  await writeAudit({
    actorId: user.id,
    action: active ? "company.reactivate" : "company.deactivate",
    entityType: "client_company",
    entityId: id,
    before: { status: before.status },
    after: { status: active ? "active" : "inactive" },
  });
  revalidatePath("/admin/empresas");
  revalidatePath(`/admin/empresas/${id}`);
  return { ok: true };
}

// --------------------------------------------------------------------------
// Sedes
// --------------------------------------------------------------------------

export async function createSiteAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const company_id = Number(str(fd, "company_id"));
  const name = str(fd, "name");
  const code = str(fd, "code") || null;
  if (!Number.isFinite(company_id)) return { status: "error", error: "Empresa inválida." };
  if (!name) return { status: "error", error: "El nombre de la sede es obligatorio." };

  try {
    const created = await prisma.site.create({ data: { company_id, name, code } });
    await writeAudit({
      actorId: user.id,
      action: "site.create",
      entityType: "site",
      entityId: created.id,
      after: created,
    });
    revalidatePath(`/admin/empresas/${company_id}`);
    return { status: "ok", message: `Sede "${name}" creada.` };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateSiteAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  const name = str(fd, "name");
  const code = str(fd, "code") || null;
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  if (!name) return { status: "error", error: "El nombre de la sede es obligatorio." };

  const before = await prisma.site.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "La sede no existe." };

  try {
    const updated = await prisma.site.update({ where: { id }, data: { name, code } });
    await writeAudit({
      actorId: user.id,
      action: "site.update",
      entityType: "site",
      entityId: id,
      before,
      after: updated,
    });
    revalidatePath(`/admin/empresas/${before.company_id}`);
    return { status: "ok", message: "Sede actualizada." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setSiteStatusAction(
  id: number,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.site.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "La sede no existe." };

  await prisma.site.update({
    where: { id },
    data: { status: active ? "active" : "inactive" },
  });
  await writeAudit({
    actorId: user.id,
    action: active ? "site.reactivate" : "site.deactivate",
    entityType: "site",
    entityId: id,
    before: { status: before.status },
    after: { status: active ? "active" : "inactive" },
  });
  revalidatePath(`/admin/empresas/${before.company_id}`);
  return { ok: true };
}
