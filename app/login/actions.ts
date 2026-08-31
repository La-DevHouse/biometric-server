"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { verifyPassword, createSession, destroySession } from "@/lib/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") || "")
    .trim()
    .toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Email y contraseña requeridos." };
  }

  const user = await prisma.app_user.findUnique({ where: { email } });
  // Comparar el hash siempre (incluso si el usuario no existe) para no filtrar
  // qué emails están registrados por timing.
  const dummyHash = "$2a$10$0000000000000000000000000000000000000000000000000000";
  const ok = await verifyPassword(password, user?.password_hash ?? dummyHash);

  if (!user || user.status !== "active" || !ok) {
    return { error: "Credenciales inválidas." };
  }

  await prisma.app_user.update({
    where: { id: user.id },
    data: { last_login_at: new Date() },
  });
  await createSession(user.id);
  redirect("/admin");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
