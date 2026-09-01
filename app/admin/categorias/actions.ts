"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";

const PATH = "/admin/categorias";

function str(fd: FormData, key: string): string {
  return String(fd.get(key) ?? "").trim();
}

// --------------------------------------------------------------------------
// Departamentos
// --------------------------------------------------------------------------

export async function createDepartmentAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const name = str(fd, "name");
  if (!name) return { status: "error", error: "El nombre es obligatorio." };
  const data = { name, code: str(fd, "code") || null, description: str(fd, "description") || null };

  try {
    const created = await prisma.department.create({ data });
    await writeAudit({ actorId: user.id, action: "department.create", entityType: "department", entityId: created.id, after: created });
    revalidatePath(PATH);
    return { status: "ok", message: `Departamento "${name}" creado.` };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateDepartmentAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  const name = str(fd, "name");
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  if (!name) return { status: "error", error: "El nombre es obligatorio." };

  const before = await prisma.department.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "El departamento no existe." };
  const data = { name, code: str(fd, "code") || null, description: str(fd, "description") || null };

  try {
    const updated = await prisma.department.update({ where: { id }, data });
    await writeAudit({ actorId: user.id, action: "department.update", entityType: "department", entityId: id, before, after: updated });
    revalidatePath(PATH);
    return { status: "ok", message: "Departamento actualizado." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setDepartmentStatusAction(
  id: number,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.department.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "El departamento no existe." };
  await prisma.department.update({ where: { id }, data: { status: active ? "active" : "inactive" } });
  await writeAudit({
    actorId: user.id,
    action: active ? "department.reactivate" : "department.deactivate",
    entityType: "department",
    entityId: id,
    before: { status: before.status },
    after: { status: active ? "active" : "inactive" },
  });
  revalidatePath(PATH);
  return { ok: true };
}

// --------------------------------------------------------------------------
// Puestos
// --------------------------------------------------------------------------

function positionData(fd: FormData) {
  const deptRaw = str(fd, "department_id");
  return {
    name: str(fd, "name"),
    code: str(fd, "code") || null,
    description: str(fd, "description") || null,
    department_id: deptRaw === "" ? null : Number(deptRaw),
  };
}

export async function createPositionAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const d = positionData(fd);
  if (!d.name) return { status: "error", error: "El nombre es obligatorio." };

  try {
    const created = await prisma.position.create({ data: d });
    await writeAudit({ actorId: user.id, action: "position.create", entityType: "position", entityId: created.id, after: created });
    revalidatePath(PATH);
    return { status: "ok", message: `Puesto "${d.name}" creado.` };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updatePositionAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  const d = positionData(fd);
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  if (!d.name) return { status: "error", error: "El nombre es obligatorio." };

  const before = await prisma.position.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "El puesto no existe." };

  try {
    const updated = await prisma.position.update({ where: { id }, data: d });
    await writeAudit({ actorId: user.id, action: "position.update", entityType: "position", entityId: id, before, after: updated });
    revalidatePath(PATH);
    return { status: "ok", message: "Puesto actualizado." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setPositionStatusAction(
  id: number,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.position.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "El puesto no existe." };
  await prisma.position.update({ where: { id }, data: { status: active ? "active" : "inactive" } });
  await writeAudit({
    actorId: user.id,
    action: active ? "position.reactivate" : "position.deactivate",
    entityType: "position",
    entityId: id,
    before: { status: before.status },
    after: { status: active ? "active" : "inactive" },
  });
  revalidatePath(PATH);
  return { ok: true };
}
