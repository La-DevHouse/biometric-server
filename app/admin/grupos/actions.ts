"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import type { AdminActionState } from "@/lib/adminActionState";

const ABSENCE_RULES = ["no_check_in", "no_marks", "under_hours"] as const;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function str(fd: FormData, k: string) {
  return String(fd.get(k) ?? "").trim();
}
function nonNegInt(fd: FormData, k: string): number | null {
  const v = str(fd, k);
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
function thresholds(fd: FormData) {
  const r = str(fd, "absence_rule");
  return {
    late_tolerance_min: nonNegInt(fd, "late_tolerance_min"),
    early_leave_tolerance_min: nonNegInt(fd, "early_leave_tolerance_min"),
    absence_rule: (ABSENCE_RULES as readonly string[]).includes(r) ? (r as (typeof ABSENCE_RULES)[number]) : null,
    absence_min_hours: nonNegInt(fd, "absence_min_hours"),
  };
}

// --------------------------------------------------------------------------
// Grupos de empleados
// --------------------------------------------------------------------------

function groupData(fd: FormData) {
  return {
    company_id: Number(str(fd, "company_id")),
    name: str(fd, "name"),
    code: str(fd, "code") || null,
    ...thresholds(fd),
  };
}

export async function createGroupAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const d = groupData(fd);
  if (!Number.isFinite(d.company_id)) return { status: "error", error: "Seleccioná una empresa." };
  if (!d.name) return { status: "error", error: "El nombre es obligatorio." };

  try {
    const created = await prisma.employee_group.create({ data: d });
    await writeAudit({ actorId: user.id, action: "group.create", entityType: "employee_group", entityId: created.id, after: created });
    revalidatePath("/admin/grupos");
    return { status: "ok", message: `Grupo "${d.name}" creado.` };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateGroupAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  const before = await prisma.employee_group.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "El grupo no existe." };

  const d = groupData(fd);
  if (!d.name) return { status: "error", error: "El nombre es obligatorio." };
  // no se permite mover un grupo de empresa (arrastraría turnos y empleos)
  const { company_id: _ignore, ...patch } = d;

  try {
    const updated = await prisma.employee_group.update({ where: { id }, data: patch });
    await writeAudit({ actorId: user.id, action: "group.update", entityType: "employee_group", entityId: id, before, after: updated });
    revalidatePath("/admin/grupos");
    revalidatePath(`/admin/grupos/${id}`);
    return { status: "ok", message: "Grupo actualizado." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function setGroupStatusAction(
  id: number,
  active: boolean
): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.employee_group.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "El grupo no existe." };
  await prisma.employee_group.update({ where: { id }, data: { status: active ? "active" : "inactive" } });
  await writeAudit({
    actorId: user.id,
    action: active ? "group.reactivate" : "group.deactivate",
    entityType: "employee_group",
    entityId: id,
    before: { status: before.status },
    after: { status: active ? "active" : "inactive" },
  });
  revalidatePath("/admin/grupos");
  revalidatePath(`/admin/grupos/${id}`);
  return { ok: true };
}

// --------------------------------------------------------------------------
// Turnos
// --------------------------------------------------------------------------

type ShiftFields = Omit<
  Prisma.shiftUncheckedCreateInput,
  "id" | "employee_group_id" | "created_at" | "updated_at" | "attendance_days"
>;

function shiftData(fd: FormData): { data?: ShiftFields; error?: string } {
  const name = str(fd, "name");
  const start_time = str(fd, "start_time");
  const end_time = str(fd, "end_time");
  const break_start = str(fd, "break_start") || null;
  const break_end = str(fd, "break_end") || null;
  const effRaw = str(fd, "effective_from");
  const effToRaw = str(fd, "effective_to");

  if (!name) return { error: "El nombre del turno es obligatorio." };
  if (!TIME_RE.test(start_time) || !TIME_RE.test(end_time))
    return { error: "Hora de inicio/fin inválida (formato HH:MM, 24h)." };
  if (break_start && !TIME_RE.test(break_start)) return { error: "Hora de inicio de descanso inválida." };
  if (break_end && !TIME_RE.test(break_end)) return { error: "Hora de fin de descanso inválida." };
  if (!effRaw) return { error: "La fecha de vigencia desde es obligatoria." };
  const effective_from = new Date(effRaw);
  const effective_to = effToRaw ? new Date(effToRaw) : null;
  if (Number.isNaN(effective_from.getTime())) return { error: "Fecha 'desde' inválida." };
  if (effective_to && effective_to < effective_from)
    return { error: "La fecha 'hasta' no puede ser anterior a 'desde'." };

  const workdays = fd.getAll("workdays").map((v) => Number(v)).filter((n) => n >= 1 && n <= 7);
  const hoursRaw = str(fd, "hours");

  return {
    data: {
      name,
      code: str(fd, "code") || null,
      start_time,
      end_time,
      break_start,
      break_end,
      hours: hoursRaw === "" ? null : hoursRaw,
      variable_in_out: fd.get("variable_in_out") === "on",
      crosses_midnight: fd.get("crosses_midnight") === "on",
      workdays,
      effective_from,
      effective_to,
    },
  };
}

export async function createShiftAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const group_id = Number(str(fd, "employee_group_id"));
  if (!Number.isFinite(group_id)) return { status: "error", error: "Grupo inválido." };
  const parsed = shiftData(fd);
  if (parsed.error) return { status: "error", error: parsed.error };

  try {
    const created = await prisma.shift.create({
      data: { ...parsed.data!, employee_group_id: group_id },
    });
    await writeAudit({ actorId: user.id, action: "shift.create", entityType: "shift", entityId: created.id, after: created });
    revalidatePath(`/admin/grupos/${group_id}`);
    return { status: "ok", message: `Turno "${parsed.data!.name}" creado.` };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function updateShiftAction(
  _prev: AdminActionState,
  fd: FormData
): Promise<AdminActionState> {
  const user = await requireUser();
  const id = Number(str(fd, "id"));
  if (!Number.isFinite(id)) return { status: "error", error: "ID inválido." };
  const before = await prisma.shift.findUnique({ where: { id } });
  if (!before) return { status: "error", error: "El turno no existe." };
  const parsed = shiftData(fd);
  if (parsed.error) return { status: "error", error: parsed.error };

  try {
    const updated = await prisma.shift.update({ where: { id }, data: parsed.data! });
    await writeAudit({ actorId: user.id, action: "shift.update", entityType: "shift", entityId: id, before, after: updated });
    revalidatePath(`/admin/grupos/${before.employee_group_id}`);
    return { status: "ok", message: "Turno actualizado." };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteShiftAction(id: number): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const before = await prisma.shift.findUnique({ where: { id } });
  if (!before) return { ok: false, error: "El turno no existe." };
  // attendance_day.shift_id es SetNull -> borrar es seguro
  await prisma.shift.delete({ where: { id } });
  await writeAudit({ actorId: user.id, action: "shift.delete", entityType: "shift", entityId: id, before });
  revalidatePath(`/admin/grupos/${before.employee_group_id}`);
  return { ok: true };
}
