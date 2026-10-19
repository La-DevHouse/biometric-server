"use server";

import { userErrorMessage } from "@/lib/serverErrors";
import { revalidatePath } from "next/cache";
import { confirmCompanyImport, deleteCompanyImport, MAX_FILE_BYTES, previewCompanyImport, reopenCompanyImport, type PreviewView } from "@/lib/import/service";
import type { Overrides } from "@/lib/import/plan";
import { allow } from "@/lib/access";
import { prisma } from "@/lib/db";

/** Paso 1 (docs/14): leer y validar el Roster de Personal de Galepso (PDF) o una planilla .xlsx, sin tocar la base. */
export async function previewCompanyImportAction(
  companyId: number,
  fd: FormData
): Promise<{ ok: true; view: PreviewView } | { ok: false; error: string }> {
  const g = await allow({ edit: true, company: companyId });
  if (!g.ok) return { ok: false, error: g.error };
  const user = g.access.user;
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No se recibió ningún archivo." };
  if (!/\.(pdf|xlsx)$/i.test(file.name)) {
    return { ok: false, error: "Suba el Roster de Personal de Galepso en PDF (o una hoja de cálculo .xlsx). El .xls que exporta Galepso viene incompleto." };
  }
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "El archivo supera los 5 MB. Divídalo en varios." };
  try {
    return { ok: true, view: await previewCompanyImport(companyId, Buffer.from(await file.arrayBuffer()), file.name, user.id) };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}

/** Retomar una importación sin confirmar del historial. */
export async function reopenCompanyImportAction(companyId: number, runId: number): Promise<{ ok: true; view: PreviewView } | { ok: false; error: string }> {
  const g = await allow({ edit: true, company: companyId });
  if (!g.ok) return { ok: false, error: g.error };
  try {
    return { ok: true, view: await reopenCompanyImport(runId, companyId) };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}

/** Borrar del historial una importación que no se aplicó. */
export async function deleteCompanyImportAction(companyId: number, runId: number): Promise<{ ok: boolean; error?: string }> {
  const g = await allow({ edit: true, company: companyId });
  if (!g.ok) return { ok: false, error: g.error };
  const user = g.access.user;
  try {
    await deleteCompanyImport(runId, companyId, user.id);
    revalidatePath(`/admin/empresas/${companyId}/importar`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}

/** Empresa de una importación (para validar el acceso); null si no existe. */
async function importCompany(runId: number): Promise<number | null> {
  return (await prisma.import_run.findUnique({ where: { id: runId }, select: { company_id: true } }))?.company_id ?? null;
}

/** Paso 2: aplicar lo previsualizado con los ajustes de la vista previa. */
export async function confirmCompanyImportAction(
  runId: number,
  overrides: Overrides
): Promise<{ ok: true; message: string } | { ok: false; error: string; view?: PreviewView }> {
  const g = await allow({ edit: true, company: await importCompany(runId) });
  if (!g.ok) return { ok: false, error: g.error };
  const user = g.access.user;
  try {
    const res = await confirmCompanyImport(runId, user.id, overrides);
    if (res.status === "changed") return { ok: false, error: res.message, view: res.view };
    revalidatePath("/admin/empleados");
    revalidatePath("/admin/empresas", "layout");
    return { ok: true, message: res.message };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}
