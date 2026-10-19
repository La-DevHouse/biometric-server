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

// --------------------------------------------------------------------------
// Guardia de las acciones del servidor
// --------------------------------------------------------------------------

/** Qué exige una acción. Los objetos (empresa, sede, equipo…) tienen que estar en el alcance. */
export interface Need {
  /** Pantallas y acciones de administración. */
  admin?: boolean;
  /** Cambia algo (Solo lectura no puede). */
  edit?: boolean;
  /** Captura, copia o borra huellas / usuarios del equipo: solo administradores. */
  fingerprints?: boolean;
  company?: number | null;
  site?: number | null;
  /** Un equipo sin sede solo lo ve un administrador. */
  device?: string | null;
  /** Una persona: tiene (o tuvo) contrato con alguna empresa del alcance. */
  employee?: number | null;
  employment?: number | null;
  schedule?: number | null;
  operation?: number | null;
}

export type Check = { ok: true; access: Access } | { ok: false; error: string };

/** Empresa de cada cosa (null = no existe o, para un equipo, sin sede). */
async function companyOf(n: Need): Promise<(number | null)[]> {
  const out: Promise<number | null>[] = [];
  if (n.company != null) out.push(Promise.resolve(n.company));
  if (n.site != null)
    out.push(prisma.site.findUnique({ where: { id: n.site }, select: { company_id: true } }).then((s) => s?.company_id ?? null));
  if (n.device != null)
    out.push(
      prisma.devices
        .findUnique({ where: { dev_id: n.device }, select: { site: { select: { company_id: true } } } })
        .then((d) => d?.site?.company_id ?? null)
    );
  if (n.employment != null)
    out.push(prisma.employment.findUnique({ where: { id: n.employment }, select: { company_id: true } }).then((e) => e?.company_id ?? null));
  if (n.schedule != null)
    out.push(prisma.schedule_group.findUnique({ where: { id: n.schedule }, select: { company_id: true } }).then((g) => g?.company_id ?? null));
  if (n.operation != null)
    out.push(
      prisma.operations
        .findUnique({ where: { id: n.operation }, select: { dev_id: true } })
        .then((o) =>
          o
            ? prisma.devices
                .findUnique({ where: { dev_id: o.dev_id }, select: { site: { select: { company_id: true } } } })
                .then((d) => d?.site?.company_id ?? null)
            : null
        )
    );
  return Promise.all(out);
}

/** ¿La persona tiene o tuvo contrato con alguna empresa del alcance? */
export async function canSeeEmployee(a: Access, employeeId: number): Promise<boolean> {
  if (a.companyIds === null) return true;
  if (a.companyIds.length === 0) return false;
  return (await prisma.employment.count({ where: { employee_id: employeeId, company_id: { in: a.companyIds } } })) > 0;
}

/** Lo que exige `need` con el acceso `a` (sin sesión: para pruebas y procesos). */
export async function checkAccess(a: Access, need: Need): Promise<Check> {
  const no: Check = { ok: false, error: DENIED };
  if (need.admin && !a.isAdmin) return no;
  if (need.edit && !a.canEdit) return no;
  if (need.fingerprints && !a.canEditFingerprints) return no;
  if (a.companyIds !== null) {
    for (const c of await companyOf(need)) if (c == null || !a.companyIds.includes(c)) return no;
    if (need.employee != null && !(await canSeeEmployee(a, need.employee))) return no;
  }
  return { ok: true, access: a };
}

/** Para las acciones: la sesión actual con lo que exige `need`. */
export async function allow(need: Need): Promise<Check> {
  return checkAccess(await requireAccess(), need);
}

/** Para las páginas: la sesión actual con lo que exige `need`; si no, "no existe". */
export async function requirePage(need: Need): Promise<Access> {
  const c = await allow(need);
  if (!c.ok) notFound();
  return c.access;
}

/** Equipos que puede ver: los de las sedes de sus empresas (sin sede, no). null = todos. */
export async function scopedDevIds(a: Access): Promise<string[] | null> {
  if (a.companyIds === null) return null;
  const rows = await prisma.devices.findMany({
    where: { site: { company_id: { in: a.companyIds } } },
    select: { dev_id: true },
  });
  return rows.map((r) => r.dev_id);
}

/** Filtro Prisma por empresa: `{}` para quien ve todas. */
export function companyIdWhere(a: Access): { in: number[] } | undefined {
  return a.companyIds === null ? undefined : { in: a.companyIds };
}
