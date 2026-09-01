"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, currentSessionToken, hashPassword, verifyPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";

const PATH = "/admin/cuentas";
const MIN_PW = 8;

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// --------------------------------------------------------------------------
// Alta / edición de cuentas
// --------------------------------------------------------------------------

export async function createAccountAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");

  if (!name) return { status: "error", error: "El nombre es obligatorio." };
  if (!EMAIL_RE.test(email)) return { status: "error", error: "Email inválido." };
  if (password.length < MIN_PW)
    return { status: "error", error: `La contraseña debe tener al menos ${MIN_PW} caracteres.` };

  try {
    const created = await prisma.app_user.create({
      data: { name, email, password_hash: await hashPassword(password) },
    });
    await writeAudit({
      actorId: user.id,
      action: "app_user.create",
      entityType: "app_user",
      entityId: created.id,
      after: { name: created.name, email: created.email, role: created.role },
    });
    revalidatePath(PATH);
    return { status: "ok", message: `Cuenta de ${name} creada.` };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `Ya existe una cuenta con el email ${email}.` };
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateAccountAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  const before = await prisma.app_user.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "La cuenta no existe." };

  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  if (!name) return { status: "error", error: "El nombre es obligatorio." };
  if (!EMAIL_RE.test(email)) return { status: "error", error: "Email inválido." };

  try {
    const updated = await prisma.app_user.update({ where: { id }, data: { name, email } });
    await writeAudit({
      actorId: user.id,
      action: "app_user.update",
      entityType: "app_user",
      entityId: id,
      before: { name: before.name, email: before.email },
      after: { name: updated.name, email: updated.email },
    });
    revalidatePath(PATH);
    return { status: "ok", message: "Cuenta actualizada." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `El email ${email} ya está en uso por otra cuenta.` };
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

// --------------------------------------------------------------------------
// Resetear contraseña de otra cuenta (recovery nivel 2, docs/07 §4)
// --------------------------------------------------------------------------

export async function resetPasswordAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  const password = String(fd.get("password") ?? "");
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  if (password.length < MIN_PW)
    return { status: "error", error: `La contraseña debe tener al menos ${MIN_PW} caracteres.` };

  const target = await prisma.app_user.findUnique({ where: { id } });
  if (!target) return { status: "error", error: "La cuenta no existe." };

  await prisma.$transaction([
    prisma.app_user.update({ where: { id }, data: { password_hash: await hashPassword(password) } }),
    // invalida todas las sesiones de esa cuenta: tendrá que entrar con la nueva clave
    prisma.app_session.deleteMany({ where: { app_user_id: id } }),
  ]);
  await writeAudit({
    actorId: user.id,
    action: "app_user.reset_password",
    entityType: "app_user",
    entityId: id,
    after: { email: target.email }, // NUNCA la contraseña
  });
  revalidatePath(PATH);
  return { status: "ok", message: `Contraseña de ${target.name} restablecida. Deberá volver a iniciar sesión.` };
}

// --------------------------------------------------------------------------
// Activar / desactivar
// --------------------------------------------------------------------------

export async function setAccountStatusAction(
  id: number,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.app_user.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "La cuenta no existe." };

  if (!active) {
    if (id === user.id) return { ok: false, error: "No podés desactivar tu propia cuenta." };
    const activeCount = await prisma.app_user.count({ where: { status: "active" } });
    if (activeCount <= 1) return { ok: false, error: "Debe quedar al menos una cuenta activa." };
  }

  await prisma.$transaction([
    prisma.app_user.update({ where: { id }, data: { status: active ? "active" : "inactive" } }),
    ...(active ? [] : [prisma.app_session.deleteMany({ where: { app_user_id: id } })]),
  ]);
  await writeAudit({
    actorId: user.id,
    action: active ? "app_user.reactivate" : "app_user.deactivate",
    entityType: "app_user",
    entityId: id,
    before: { status: before.status },
    after: { status: active ? "active" : "inactive" },
  });
  revalidatePath(PATH);
  return { ok: true };
}

// --------------------------------------------------------------------------
// Cambiar mi propia contraseña
// --------------------------------------------------------------------------

export async function changeMyPasswordAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const current = String(fd.get("current_password") ?? "");
  const next = String(fd.get("new_password") ?? "");
  if (next.length < MIN_PW)
    return { status: "error", error: `La nueva contraseña debe tener al menos ${MIN_PW} caracteres.` };

  const row = await prisma.app_user.findUnique({ where: { id: user.id } });
  if (!row) return { status: "error", error: "La cuenta no existe." };
  if (!(await verifyPassword(current, row.password_hash)))
    return { status: "error", error: "La contraseña actual no es correcta." };

  const keep = await currentSessionToken();
  await prisma.$transaction([
    prisma.app_user.update({ where: { id: user.id }, data: { password_hash: await hashPassword(next) } }),
    // cierra las demás sesiones de esta cuenta; conserva la actual
    prisma.app_session.deleteMany({
      where: { app_user_id: user.id, ...(keep ? { NOT: { token: keep } } : {}) },
    }),
  ]);
  await writeAudit({
    actorId: user.id,
    action: "app_user.change_password",
    entityType: "app_user",
    entityId: user.id,
  });
  revalidatePath(PATH);
  return { status: "ok", message: "Contraseña actualizada." };
}
