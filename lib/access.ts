// Perfiles de acceso (docs/18). Un solo lugar decide qué puede hacer una cuenta y
// con qué empresas; las pantallas, acciones y descargas lo consultan aquí. Se
// valida SIEMPRE en el servidor: ocultar un botón no alcanza.
//
//   Administrador (admin)  todo, todas las empresas, y las pantallas de
//                          administración (Cuentas, Auditoría, Categorías,
//                          Diagnóstico, Grupos).
//   Solo lectura (viewer)  ve y descarga; todas las empresas o solo algunas.
//   Socio (operator)       trabaja (edita) solo con ciertas empresas, sin crear
//                          empresas y sin editar huellas (una huella es de la
//                          persona y vale en todos los equipos, también ajenos).
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getSessionUser, type SessionUser } from "@/lib/auth";

export { PROFILE_HINT, PROFILE_LABEL, type Profile } from "@/lib/accessLabels";

export interface Access {
  user: SessionUser;
  isAdmin: boolean;
  /** Puede crear, editar, corregir y operar equipos (dentro de su alcance). */
  canEdit: boolean;
  /** Capturar, copiar o borrar huellas: solo administradores. */
  canEditFingerprints: boolean;
  /** Empresas que puede ver; null = todas. */
  companyIds: number[] | null;
}

/** Mensaje de las acciones rechazadas (el servidor no dice más que eso). */
export const DENIED = "Su cuenta no tiene permiso para esto.";

/** El acceso de la sesión actual, una vez por request. null = sin sesión. */
export const getAccess = cache(async (): Promise<Access | null> => {
  const user = await getSessionUser();
  return user ? accessFor(user) : null;
});

/** El acceso de una cuenta (sin pasar por la cookie: pruebas y procesos). */
export async function accessFor(user: SessionUser): Promise<Access> {
  const isAdmin = user.role === "admin";
  let companyIds: number[] | null = null;
  if (!isAdmin) {
    const u = await prisma.app_user.findUnique({
      where: { id: user.id },
      select: { all_companies: true, companies: { select: { company_id: true } } },
    });
    companyIds = u?.all_companies ? null : (u?.companies.map((c) => c.company_id) ?? []);
  }
  return {
    user,
    isAdmin,
    canEdit: user.role === "admin" || user.role === "operator",
    canEditFingerprints: isAdmin,
    companyIds,
  };
}

/** Páginas y acciones: el acceso o, sin sesión, al login. */
export async function requireAccess(): Promise<Access> {
  const a = await getAccess();
  if (!a) redirect("/login");
  return a;
}

/** Pantallas de administración: a quien no es administrador le responden "no existe". */
export async function requireAdminPage(): Promise<Access> {
  const a = await requireAccess();
  if (!a.isAdmin) notFound();
  return a;
}

/** ¿Puede ver esta empresa? */
export function canSeeCompany(a: Access, companyId: number): boolean {
  return a.companyIds === null || a.companyIds.includes(companyId);
}

/** Página de una empresa ajena: "no existe" (no revela que hay algo ahí). */
export function assertCompanyPage(a: Access, companyId: number): void {
  if (!canSeeCompany(a, companyId)) notFound();
}

/** Filtro Prisma por empresa: `{}` para quien ve todas. */
export function companyIdWhere(a: Access): { in: number[] } | undefined {
  return a.companyIds === null ? undefined : { in: a.companyIds };
}
