"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";
import { joinDoc } from "@/lib/documento";
import { triggerReconcile, devicesAffectedByEmployee } from "@/lib/sync/reconcile";

/** Dispara el reconciliador en los equipos afectados (docs/10 §4.3); no fatal. */
async function syncNote(employeeId: number): Promise<string> {
  try {
    const n = (await triggerReconcile(await devicesAffectedByEmployee(employeeId), "event")).length;
    return n > 0 ? ` Sincronizando ${n} equipo(s).` : "";
  } catch (e) {
    console.error("no se pudo disparar la sincronización:", e);
    return "";
  }
}
import { extractCedula, type CedulaExtractedFields } from "@/lib/documentVision";

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}
function optId(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  return v === "" ? null : Number(v);
}
function optDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

// --------------------------------------------------------------------------
// Persona (employee)
// --------------------------------------------------------------------------

type PersonData = {
  national_id: string;
  tax_id: string;
  first_name: string;
  last_name: string;
  birth_date: Date | null;
};

function personData(fd: FormData): { data: PersonData } | { error: string } {
  const ced = joinDoc(str(fd, "doc_prefix"), str(fd, "doc_number"), "cedula");
  if ("error" in ced) return { error: ced.error };

  const rifPrefix = str(fd, "rif_prefix");
  const rifNumber = str(fd, "rif_number");
  let tax_id = ced.value; // vacío = igual a la cédula
  // Solo el número indica intención real de cargar un RIF distinto — el
  // prefijo puede venir preseleccionado en el <select> sin que se haya
  // tocado nada (mismo caso que en empresas/actions.ts).
  if (rifNumber) {
    const rif = joinDoc(rifPrefix, rifNumber, "rif");
    if ("error" in rif) return { error: rif.error };
    tax_id = rif.value;
  }

  return {
    data: {
      national_id: ced.value,
      tax_id,
      first_name: str(fd, "first_name"),
      last_name: str(fd, "last_name"),
      birth_date: optDate(str(fd, "birth_date")),
    },
  };
}

/**
 * Foto de la cédula del form. `undefined` = no se adjuntó nada (no tocar lo
 * que ya hubiera); a diferencia del logo de empresa, acá no hay checkbox de
 * "quitar" — la foto se conserva siempre que se cargue una vez (docs/09 §3.10,
 * decisión explícita del cliente: se guarda luego de extraer los datos).
 */
async function cedulaPhotoFromForm(fd: FormData): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const file = fd.get("cedula_photo");
  if (!(file instanceof File) || file.size === 0) return undefined;
  if (file.size > 8 * 1024 * 1024) throw new Error("La foto de la cédula no puede superar 8 MB.");
  return new Uint8Array(Buffer.from(await file.arrayBuffer()));
}

/** Reemplaza el blob de la foto por un resumen para no volcarlo al audit_log. */
function auditView<T extends { cedula_photo?: Uint8Array<ArrayBufferLike> | null }>(row: T) {
  return { ...row, cedula_photo: row.cedula_photo ? `[${row.cedula_photo.byteLength} bytes]` : null };
}

// --------------------------------------------------------------------------
// Escaneo de cédula por foto (docs/09 §3.10 / §7.1 ítem 17, AI 25)
// --------------------------------------------------------------------------

/**
 * Lee una foto de cédula con Gemini (lib/documentVision.ts) y devuelve los
 * campos para precargar el form. No crea ni guarda nada — eso lo hace el
 * submit normal de crear/editar persona, que además persiste la foto misma.
 */
export async function extractCedulaAction(
  fd: FormData
): Promise<{ ok: true; fields: CedulaExtractedFields } | { ok: false; error: string }> {
  await requireUser();

  const file = fd.get("photo");
  if (!(file instanceof File)) return { ok: false, error: "No se recibió la foto." };
  if (!file.type.startsWith("image/")) return { ok: false, error: "El archivo debe ser una imagen." };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "La imagen no puede superar 8 MB." };

  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const fields = await extractCedula(buf, file.type);
    return { ok: true, fields };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "No se pudo leer la cédula." };
  }
}

export async function createEmployeeAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const parsed = personData(fd);
  if ("error" in parsed) return { status: "error", error: parsed.error };
  const d = parsed.data;
  if (!d.first_name || !d.last_name)
    return { status: "error", error: "Nombre y apellido son obligatorios." };

  let cedulaPhoto: Uint8Array<ArrayBuffer> | undefined;
  try {
    cedulaPhoto = await cedulaPhotoFromForm(fd);
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const created = await prisma.employee.create({ data: { ...d, cedula_photo: cedulaPhoto ?? null } });
    await writeAudit({ actorId: user.id, action: "employee.create", entityType: "employee", entityId: created.id, after: auditView(created) });
    revalidatePath("/admin/empleados");
    return { status: "ok", message: `${d.first_name} ${d.last_name} registrado/a.` };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `Ya existe una persona con el documento ${d.national_id}.` };
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateEmployeeAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  const before = await prisma.employee.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "La persona no existe." };

  const parsed = personData(fd);
  if ("error" in parsed) return { status: "error", error: parsed.error };
  const d = parsed.data;
  if (!d.first_name || !d.last_name)
    return { status: "error", error: "Nombre y apellido son obligatorios." };

  let cedulaPhoto: Uint8Array<ArrayBuffer> | undefined;
  try {
    cedulaPhoto = await cedulaPhotoFromForm(fd);
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }

  try {
    const updated = await prisma.employee.update({
      where: { id },
      data: cedulaPhoto === undefined ? d : { ...d, cedula_photo: cedulaPhoto },
    });
    await writeAudit({ actorId: user.id, action: "employee.update", entityType: "employee", entityId: id, before: auditView(before), after: auditView(updated) });
    revalidatePath("/admin/empleados");
    revalidatePath(`/admin/empleados/${id}`);
    return { status: "ok", message: "Datos actualizados." };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")
      return { status: "error", error: `El documento ${d.national_id} ya está en uso por otra persona.` };
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

// --------------------------------------------------------------------------
// Contrato de trabajo (employment)
// --------------------------------------------------------------------------

const PAYROLL_TYPES = ["quincenal", "semanal"] as const;

function employmentData(fd: FormData) {
  const posRaw = str(fd, "position_id");
  const ptRaw = str(fd, "payroll_type");
  return {
    company_id: Number(str(fd, "company_id")),
    schedule_group_id: optId(fd, "schedule_group_id"),
    // "__new__" → null acá; lo resuelve resolvePositionId() creando el puesto
    position_id: posRaw === "" || posRaw === "__new__" ? null : Number(posRaw),
    department_id: optId(fd, "department_id"),
    payroll_ref: str(fd, "payroll_ref") || null,
    payroll_type: (PAYROLL_TYPES as readonly string[]).includes(ptRaw)
      ? (ptRaw as (typeof PAYROLL_TYPES)[number])
      : null,
    start_date: optDate(str(fd, "start_date")),
  };
}

/**
 * Si el form eligió "otro: crear puesto nuevo", crea el `position` (asociado al
 * modelo de negocio de la empresa, o genérico si no tiene) y devuelve
 * su id. Si no, devuelve el `position_id` ya parseado.
 */
async function resolvePositionId(
  fd: FormData,
  fallbackPositionId: number | null,
  companyId: number,
  userId: number
): Promise<{ id: number | null } | { error: string }> {
  if (str(fd, "position_id") !== "__new__") return { id: fallbackPositionId };
  const name = str(fd, "new_position_name");
  if (!name) return { error: "Escribí el nombre del puesto nuevo." };

  const company = await prisma.client_company.findUnique({
    where: { id: companyId },
    select: { business_model_id: true },
  });
  // Ya no se hereda del grupo: el grupo no tiene atributos propios (docs/10 §2).
  const bmId = company?.business_model_id ?? null;

  // `position` no tiene columna business_model: el vínculo es M:N vía
  // position_business_model. Sin modelo → cargo genérico (sin filas).
  const business_model_ids = bmId != null ? [bmId] : [];
  const created = await prisma.position.create({
    data: {
      name,
      business_models: { create: business_model_ids.map((id) => ({ business_model_id: id })) },
    },
  });
  await writeAudit({
    actorId: userId,
    action: "position.create",
    entityType: "position",
    entityId: created.id,
    after: { ...created, via: "employment_form", business_model_ids },
  });
  return { id: created.id };
}

export async function createEmploymentAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const employee_id = Number(str(fd, "employee_id"));
  const d = employmentData(fd);
  if (!Number.isFinite(employee_id)) return { status: "error", error: "Persona inválida." };
  if (!Number.isFinite(d.company_id)) return { status: "error", error: "Seleccioná una empresa." };
  if (!d.start_date) return { status: "error", error: "La fecha de inicio es obligatoria." };

  const pos = await resolvePositionId(fd, d.position_id, d.company_id, user.id);
  if ("error" in pos) return { status: "error", error: pos.error };
  d.position_id = pos.id;

  try {
    const created = await prisma.employment.create({
      data: { ...d, start_date: d.start_date, employee_id },
    });
    await writeAudit({ actorId: user.id, action: "employment.create", entityType: "employment", entityId: created.id, after: created });

    // Enrolar en todos los equipos de su alcance (docs/10 R6): lo hace el reconciliador.
    const note = await syncNote(employee_id);

    revalidatePath(`/admin/empleados/${employee_id}`);
    revalidatePath("/admin/empleados");
    return { status: "ok", message: "Contrato registrado." + note };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function endEmploymentAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  const endDate = optDate(str(fd, "end_date"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  if (!endDate) return { status: "error", error: "La fecha de baja es obligatoria." };

  const before = await prisma.employment.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "El contrato no existe." };
  if (endDate < before.start_date)
    return { status: "error", error: "La fecha de baja no puede ser anterior al inicio." };

  try {
    const updated = await prisma.employment.update({
      where: { id },
      data: { end_date: endDate, status: "inactive" },
    });
    await writeAudit({ actorId: user.id, action: "employment.end", entityType: "employment", entityId: id, before, after: updated });
    // Sale del alcance → el reconciliador lo quita de los equipos que ya no le aplican (con salvaguardas).
    const note = await syncNote(before.employee_id);
    revalidatePath(`/admin/empleados/${before.employee_id}`);
    revalidatePath("/admin/empleados");
    return { status: "ok", message: "Baja registrada." + note };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Editar un contrato (docs/11 P2): el mismo formulario del alta, precargado,
 * sobre la MISMA fila. La empresa no se edita — pasar a alguien a otra empresa
 * es dar de baja este contrato y crear uno nuevo, para conservar el historial
 * (docs/09 D5). Si la fecha de inicio cambia, puede entrar o salir del alcance
 * de hoy: lo resuelve el reconciliador como cualquier cambio de contrato.
 */
export async function updateEmploymentAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "Contrato inválido." };

  const before = await prisma.employment.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "El contrato no existe." };
  if (before.status !== "active") return { status: "error", error: "El contrato está cerrado: no se edita." };

  const d = employmentData(fd);
  if (!d.start_date) return { status: "error", error: "La fecha de inicio es obligatoria." };
  if (before.end_date && d.start_date > before.end_date)
    return { status: "error", error: "La fecha de inicio no puede ser posterior a la de baja." };
  if (d.schedule_group_id != null) {
    const g = await prisma.schedule_group.findUnique({ where: { id: d.schedule_group_id }, select: { company_id: true } });
    if (g?.company_id !== before.company_id)
      return { status: "error", error: "El horario no es de la empresa del contrato." };
  }

  const pos = await resolvePositionId(fd, d.position_id, before.company_id, user.id);
  if ("error" in pos) return { status: "error", error: pos.error };

  try {
    const updated = await prisma.employment.update({
      where: { id },
      data: {
        // company_id NO: la empresa del contrato es fija.
        schedule_group_id: d.schedule_group_id,
        position_id: pos.id,
        department_id: d.department_id,
        payroll_ref: d.payroll_ref,
        payroll_type: d.payroll_type,
        start_date: d.start_date,
      },
    });
    await writeAudit({ actorId: user.id, action: "employment.update", entityType: "employment", entityId: id, before, after: updated });
    const note =
      updated.start_date.getTime() !== before.start_date.getTime() ? await syncNote(before.employee_id) : "";
    revalidatePath(`/admin/empleados/${before.employee_id}`);
    revalidatePath("/admin/empleados");
    return { status: "ok", message: "Contrato actualizado." + note };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
