// Auth de la plataforma — login por email+contraseña, sesión con token opaco
// en cookie httpOnly cuya fila en `app_session` es la fuente de verdad.
// Fase 1: sin matriz de permisos (docs/07 §4) — `requireUser` solo exige sesión.
//
// `createSession` / `destroySession` mutan cookies → solo llamarlas desde un
// Server Action o Route Handler, nunca durante el render de un Server Component.

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";

export { hashPassword, verifyPassword } from "@/lib/password";

const COOKIE = "session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 días

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: "admin" | "operator" | "viewer";
}

export async function createSession(userId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const userAgent = (await headers()).get("user-agent");

  await prisma.app_session.create({
    data: {
      token,
      app_user_id: userId,
      expires_at: expiresAt,
      user_agent: userAgent ?? null,
    },
  });

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) {
    await prisma.app_session.deleteMany({ where: { token } });
    jar.delete(COOKIE);
  }
}

/** Lee la cookie y valida la sesión contra la BD. `null` si no hay una válida. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.app_session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expires_at.getTime() < Date.now()) return null;
  if (session.user.status !== "active") return null;

  const u = session.user;
  return { id: u.id, email: u.email, name: u.name, role: u.role };
}

/** Para páginas/layouts/server actions: devuelve el usuario o hace redirect a /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
