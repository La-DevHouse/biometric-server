"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";
import { joinDoc } from "@/lib/documento";

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
  if (rifPrefix || rifNumber) {
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

  try {
    const created = await prisma.employee.create({ data: d });
    await writeAudit({ actorId: user.id, action: "employee.create", entityType: "employee", entityId: created.id, after: created });
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

  try {
    const updated = await prisma.employee.update({ where: { id }, data: d });
    await writeAudit({ actorId: user.id, action: "employee.update", entityType: "employee", entityId: id, before, after: updated });
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
// Empleo (employment)
// --------------------------------------------------------------------------

function employmentData(fd: FormData) {
  return {
    company_id: Number(str(fd, "company_id")),
    site_id: optId(fd, "site_id"),
    employee_group_id: optId(fd, "employee_group_id"),
    position_id: optId(fd, "position_id"),
    department_id: optId(fd, "department_id"),
    payroll_ref: str(fd, "payroll_ref") || null,
    start_date: optDate(str(fd, "start_date")),
  };
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

  try {
    const created = await prisma.employment.create({
      data: { ...d, start_date: d.start_date, employee_id },
    });
    await writeAudit({ actorId: user.id, action: "employment.create", entityType: "employment", entityId: created.id, after: created });
    revalidatePath(`/admin/empleados/${employee_id}`);
    revalidatePath("/admin/empleados");
    return { status: "ok", message: "Empleo registrado." };
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
  if (!before) return { status: "error", error: "El empleo no existe." };
  if (endDate < before.start_date)
    return { status: "error", error: "La fecha de baja no puede ser anterior al inicio." };

  try {
    const updated = await prisma.employment.update({
      where: { id },
      data: { end_date: endDate, status: "inactive" },
    });
    await writeAudit({ actorId: user.id, action: "employment.end", entityType: "employment", entityId: id, before, after: updated });
    revalidatePath(`/admin/empleados/${before.employee_id}`);
    revalidatePath("/admin/empleados");
    return { status: "ok", message: "Baja registrada." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function transferEmployeeAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const from_employment_id = Number(str(fd, "from_employment_id"));
  const d = employmentData(fd); // company/site/group/position/department destino + start_date = fecha del traslado
  const transferDate = d.start_date;
  if (!Number.isFinite(from_employment_id)) return { status: "error", error: "Empleo origen inválido." };
  if (!transferDate) return { status: "error", error: "La fecha del traslado es obligatoria." };
  if (!Number.isFinite(d.company_id)) return { status: "error", error: "Seleccioná la empresa destino." };

  const from = await prisma.employment.findUnique({ where: { id: from_employment_id } });
  if (!from) return { status: "error", error: "El empleo origen no existe." };
  if (from.status !== "active") return { status: "error", error: "El empleo origen ya está cerrado." };
  if (transferDate < from.start_date)
    return { status: "error", error: "El traslado no puede ser anterior al inicio del empleo origen." };

  try {
    const result = await prisma.$transaction(async (tx) => {
      const closed = await tx.employment.update({
        where: { id: from_employment_id },
        data: { end_date: transferDate, status: "inactive" },
      });
      const opened = await tx.employment.create({
        data: {
          employee_id: from.employee_id,
          company_id: d.company_id,
          site_id: d.site_id,
          employee_group_id: d.employee_group_id,
          position_id: d.position_id,
          department_id: d.department_id,
          payroll_ref: d.payroll_ref,
          start_date: transferDate,
        },
      });
      return { closed, opened };
    });
    await writeAudit({
      actorId: user.id,
      action: "employee.transfer",
      entityType: "employee",
      entityId: from.employee_id,
      before: { from_employment: result.closed.id, from_company: from.company_id },
      after: { new_employment: result.opened.id, to_company: d.company_id, date: transferDate },
    });
    revalidatePath(`/admin/empleados/${from.employee_id}`);
    revalidatePath("/admin/empleados");
    return { status: "ok", message: "Traslado registrado." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}
