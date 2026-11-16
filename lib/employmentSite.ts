// Sede del contrato (2026-11-16): SOLO INFORMATIVA — dónde trabaja la persona. No
// cambia en qué equipos está: eso sigue saliendo de la empresa del contrato (docs/10 R6).
//   - Elegida: tiene que ser una sede activa de la empresa del contrato (o la que el
//     contrato ya tenía, aunque después se haya desactivado).
//   - Sin elegir: si la empresa tiene una sola sede activa, esa; si tiene varias, es
//     obligatoria.
import { prisma } from "@/lib/db";

export type SiteResolution = { siteId: number | null } | { error: string };

export async function resolveContractSite(
  companyId: number,
  siteId: number | null,
  /** Edición: la sede que el contrato ya tenía, válida aunque hoy esté inactiva. */
  current: number | null = null
): Promise<SiteResolution> {
  const sites = await prisma.site.findMany({ where: { company_id: companyId }, select: { id: true, status: true } });
  if (siteId != null) {
    const s = sites.find((x) => x.id === siteId);
    if (!s || (s.status !== "active" && s.id !== current)) return { error: "La sede no es de la empresa del contrato." };
    return { siteId };
  }
  const active = sites.filter((s) => s.status === "active");
  if (active.length === 1) return { siteId: active[0].id };
  if (active.length > 1) return { error: "La empresa tiene varias sedes: elija la sede del contrato." };
  return { siteId: null };
}

/** Para altas sin formulario (importación, registro rápido): la única sede activa, o ninguna. */
export async function onlySiteOf(companyId: number): Promise<number | null> {
  const active = await prisma.site.findMany({ where: { company_id: companyId, status: "active" }, select: { id: true }, take: 2 });
  return active.length === 1 ? active[0].id : null;
}
