"use server";

import { userErrorMessage } from "@/lib/serverErrors";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser, currentSessionToken, hashPassword, verifyPassword } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";
import { DENIED, requireAccess, type Profile } from "@/lib/access";

const PATH = "/admin/cuentas";
const MIN_PW = 8;

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Cuentas: solo administradores (docs/18). Devuelve el usuario o null. */
async function adminOnly() {
  const a = await requireAccess();
  return a.isAdmin ? a.user : null;
}

interface ProfileInput {
  role: Profile;
  all_companies: boolean;
  companyIds: number[];
}

/**
 * Perfil del formulario (docs/18): Administrador = todas; Socio = solo las
 * elegidas (al menos una); Solo lectura = todas o solo las elegidas.
 */
async function parseProfile(fd: FormData): Promise<ProfileInput | { error: string }> {
  const role = str(fd, "role") as Profile;
  if (!["admin", "viewer", "operator"].includes(role)) return { error: "Elija el perfil de la cuenta." };
  const all = role === "admin" || (role === "viewer" && str(fd, "scope") !== "some");
  const companyIds = all ? [] : [...new Set(fd.getAll("company_ids").map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!all && companyIds.length === 0) return { error: "Elija al menos una empresa para esta cuenta." };
  if (companyIds.length && (await prisma.client_company.count({ where: { id: { in: companyIds } } })) !== companyIds.length)
    return { error: "Alguna de las empresas elegidas ya no existe. Recargue la página." };
  return { role, all_companies: all, companyIds };
}

const profileAudit = (p: ProfileInput) => ({ role: p.role, all_companies: p.all_companies, company_ids: p.companyIds });

// --------------------------------------------------------------------------
// Alta / edición de cuentas
// --------------------------------------------------------------------------

export async function createAccountAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await adminOnly();
  if (!user) return { status: "error", error: DENIED };
  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  const password = String(fd.get("password") ?? "");
  const profile = await parseProfile(fd);
  if ("error" in profile) return { status: "error", error: profile.error };

  if (!name) return { status: "error", error: "El nombre es obligatorio." };
  if (!EMAIL_RE.test(email)) return { status: "error", error: "Email inválido." };
  if (password.length < MIN_PW)
    return { status: "error", error: `La contraseña debe tener al menos ${MIN_PW} caracteres.` };

  try {
    const created = await prisma.app_user.create({
      data: {
        name,
        email,
        password_hash: await hashPassword(password),
        role: profile.role,
        all_companies: profile.all_companies,
        companies: { create: profile.companyIds.map((company_id) => ({ company_id })) },
      },
    });
    await writeAudit({
      actorId: user.id,
      action: "app_user.create",
      entityType: "app_user",
      entityId: created.id,
      after: { name: created.name, email: created.email, ...profileAudit(profile) },
    });
    revalidatePath(PATH);
    return { status: "ok", message: `Cuenta de ${name} creada.` };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `Ya existe una cuenta con el email ${email}.` };
    return { status: "error", error: userErrorMessage(e) };
  }
}

export async function updateAccountAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await adminOnly();
  if (!user) return { status: "error", error: DENIED };
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  const before = await prisma.app_user.findUnique({ where: { id }, include: { companies: { select: { company_id: true } } } });
  if (!before) return { status: "error", error: "La cuenta no existe." };
  const profile = await parseProfile(fd);
  if ("error" in profile) return { status: "error", error: profile.error };
  if (id === user.id && profile.role !== before.role)
    return { status: "error", error: "No puede cambiar el perfil de su propia cuenta." };
  if (before.role === "admin" && profile.role !== "admin" && before.status === "active") {
    const admins = await prisma.app_user.count({ where: { role: "admin", status: "active" } });
    if (admins <= 1) return { status: "error", error: "Debe quedar al menos un administrador activo." };
  }

  const name = str(fd, "name");
  const email = str(fd, "email").toLowerCase();
  if (!name) return { status: "error", error: "El nombre es obligatorio." };
  if (!EMAIL_RE.test(email)) return { status: "error", error: "Email inválido." };

  try {
    // El acceso cambia de inmediato: cada request vuelve a leer el perfil y las empresas.
    const updated = await prisma.$transaction(async (tx) => {
      await tx.app_user_company.deleteMany({ where: { app_user_id: id } });
      return tx.app_user.update({
        where: { id },
        data: {
          name,
          email,
          role: profile.role,
          all_companies: profile.all_companies,
          companies: { create: profile.companyIds.map((company_id) => ({ company_id })) },
        },
      });
    });
    await writeAudit({
      actorId: user.id,
      action: "app_user.update",
      entityType: "app_user",
      entityId: id,
      before: {
        name: before.name,
        email: before.email,
        role: before.role,
        all_companies: before.all_companies,
        company_ids: before.companies.map((c) => c.company_id),
      },
      after: { name: updated.name, email: updated.email, ...profileAudit(profile) },
    });
    revalidatePath(PATH);
    return { status: "ok", message: "Cuenta actualizada." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `El email ${email} ya está en uso por otra cuenta.` };
    return { status: "error", error: userErrorMessage(e) };
  }
}

// --------------------------------------------------------------------------
// Resetear contraseña de otra cuenta (recovery nivel 2, docs/07 §4)
// --------------------------------------------------------------------------

export async function resetPasswordAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await adminOnly();
  if (!user) return { status: "error", error: DENIED };
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
  const user = await adminOnly();
  if (!user) return { ok: false, error: DENIED };
  const before = await prisma.app_user.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "La cuenta no existe." };

  if (!active) {
    if (id === user.id) return { ok: false, error: "No puede desactivar su propia cuenta." };
    const activeCount = await prisma.app_user.count({ where: { status: "active" } });
    if (activeCount <= 1) return { ok: false, error: "Debe quedar al menos una cuenta activa." };
    if (before.role === "admin") {
      const admins = await prisma.app_user.count({ where: { role: "admin", status: "active" } });
      if (admins <= 1) return { ok: false, error: "Debe quedar al menos un administrador activo." };
    }
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
