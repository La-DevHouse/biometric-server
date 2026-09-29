"use server";

import { userErrorMessage } from "@/lib/serverErrors";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { confirmCompanyImport, MAX_FILE_BYTES, previewCompanyImport, reopenCompanyImport, type PreviewView } from "@/lib/import/service";
import type { Overrides } from "@/lib/import/plan";

/** Paso 1 (docs/14): leer y validar el export de Galepso, sin tocar la base. */
export async function previewCompanyImportAction(
  companyId: number,
  fd: FormData
): Promise<{ ok: true; view: PreviewView } | { ok: false; error: string }> {
  const user = await requireUser();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No se recibió ningún archivo." };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "El archivo tiene que ser un Excel .xlsx (si es .xls viejo, abrilo y guardalo como .xlsx)." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "El archivo supera los 5 MB. Dividilo en varios." };
  try {
    return { ok: true, view: await previewCompanyImport(companyId, Buffer.from(await file.arrayBuffer()), file.name, user.id) };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}

/** Retomar una importación sin confirmar del historial. */
export async function reopenCompanyImportAction(companyId: number, runId: number): Promise<{ ok: true; view: PreviewView } | { ok: false; error: string }> {
  await requireUser();
  try {
    return { ok: true, view: await reopenCompanyImport(runId, companyId) };
  } catch (e) {
    return { ok: false, error: userErrorMessage(e) };
  }
}

/** Paso 2: aplicar lo previsualizado con los ajustes de la vista previa. */
export async function confirmCompanyImportAction(
  runId: number,
  overrides: Overrides
): Promise<{ ok: true; message: string } | { ok: false; error: string; view?: PreviewView }> {
  const user = await requireUser();
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
