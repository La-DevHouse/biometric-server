"use server";

import { revalidatePath } from "next/cache";
import { initDb, runAsync, prisma } from "@/lib/db";
import { COMMAND_TEMPLATES } from "@/lib/commandTemplates";
import {
  startSyncClock,
  startRenameDevice,
  startSyncUsers,
  startRenameUser,
  startChangePrivilege,
  startDeleteUser,
  startSyncLogs,
  startClearLogs,
  startClearEnrollData,
  startViewBiometrics,
  startRefreshStatus,
  cancelOperation,
  type Privilege,
} from "@/lib/operations";
import type { OpActionState, MultiOpActionState } from "@/lib/opActionState";
import { requireUser } from "@/lib/auth";
import { startReconcileDevice, reconcileAll, resolveSyncHold, triggerReconcile, devicesAffectedByEmployee } from "@/lib/sync/reconcile";
import { previewImpact, type ScopeChange, type ImpactResult } from "@/lib/sync/impact";
import { attendancePullDevices } from "@/lib/sync/attendance";

export type QueueCommandState =
  | { status: "idle" }
  | { status: "ok"; transId: number }
  | { status: "error"; message: string };

/**
 * Queues a raw, low-level command exactly as the old debug form did — this
 * intentionally bypasses lib/operations. It's the tool that discovered every
 * firmware quirk, so it stays available for direct experimentation.
 */
export async function queueCommandAction(
  _prev: QueueCommandState,
  formData: FormData
): Promise<QueueCommandState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  const cmdCode = String(formData.get("cmd_code") || "");

  if (!devId) return { status: "error", message: "Selecciona un dispositivo." };
  const template = COMMAND_TEMPLATES[cmdCode];
  if (!template) return { status: "error", message: "Selecciona un comando válido." };

  const params: Record<string, string> = {};
  for (const key of Object.keys(template.params ?? {})) {
    const value = formData.get(`param:${key}`);
    if (typeof value === "string" && value !== "") params[key] = value;
  }

  await initDb();
  try {
    const { lastID } = await runAsync(
      `INSERT INTO commands (dev_id, cmd_code, cmd_param, status) VALUES (?, ?, ?, 'WAIT')
       RETURNING trans_id`,
      [devId, cmdCode, JSON.stringify(params)]
    );
    revalidatePath("/admin/diagnostico");
    return { status: "ok", transId: lastID };
  } catch (err) {
    return { status: "error", message: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Operaciones de alto nivel — wrappers delgados sobre lib/operations. Cada
// uno valida el FormData, llama al start* correspondiente y deja que el
// `warning` (si lo hay) llegue hasta el diálogo/botón que lo invocó. El
// progreso real de 10-40s lo refleja el propio diálogo, sondeando
// app/api/operations/[id] vía components/admin/useOperation — estas actions
// solo encolan y devuelven de inmediato.
// ---------------------------------------------------------------------------

function opError(err: unknown): OpActionState {
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

async function afterStart(): Promise<void> {
  await initDb();
  revalidatePath("/admin", "layout");
}

export async function syncClockAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const { id, warning } = await startSyncClock(devId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function refreshStatusAction(
  _prev: OpActionState,
  formData: FormData
): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const { id, warning } = await startRefreshStatus(devId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function renameDeviceAction(
  _prev: OpActionState,
  formData: FormData
): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  const fkName = String(formData.get("fk_name") || "");
  try {
    const { id, warning } = await startRenameDevice(devId, fkName);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function syncUsersAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const { id, warning } = await startSyncUsers(devId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function renameUserAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  const userId = String(formData.get("user_id") || "");
  const userName = String(formData.get("user_name") || "");
  try {
    const { id, warning } = await startRenameUser(devId, userId, userName);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function changePrivilegeAction(
  _prev: OpActionState,
  formData: FormData
): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  const userId = String(formData.get("user_id") || "");
  const privilege = String(formData.get("user_privilege") || "") as Privilege;
  try {
    const { id, warning } = await startChangePrivilege(devId, userId, privilege);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}


export async function deleteUserAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  const userId = String(formData.get("user_id") || "");
  try {
    const { id, warning } = await startDeleteUser(devId, userId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function viewBiometricsAction(
  _prev: OpActionState,
  formData: FormData
): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  const userId = String(formData.get("user_id") || "");
  try {
    const { id, warning } = await startViewBiometrics(devId, userId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function syncLogsAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const { id, warning } = await startSyncLogs(devId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function clearLogsAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const { id, warning } = await startClearLogs(devId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function clearEnrollAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const { id, warning } = await startClearEnrollData(devId);
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}



export async function cancelOperationAction(id: number): Promise<{ ok: boolean; reason?: string }> {
  await requireUser();
  const result = await cancelOperation(id);
  revalidatePath("/admin", "layout");
  return result;
}

// ---------------------------------------------------------------------------
// Sincronización de huellas (reconciliador, docs/10 §4.2–§4.5)
// ---------------------------------------------------------------------------

/** "Sincronizar ahora" de un equipo: corrida forzada (relee el equipo aunque los contadores no cambien). */
export async function syncDeviceNowAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  const user = await requireUser();
  const devId = String(formData.get("dev_id") || "");
  try {
    const id = await startReconcileDevice(devId, { trigger: "manual", force: true, actorId: user.id });
    if (id === null) {
      return { status: "error", message: "Este equipo no tiene una sede activa asignada: está congelado y no se sincroniza." };
    }
    await afterStart();
    return { status: "ok", id };
  } catch (err) {
    return opError(err);
  }
}

/** "Sincronizar todos": una corrida por cada equipo asignado a una sede. */
export async function syncAllDevicesAction(_prev: MultiOpActionState, _formData: FormData): Promise<MultiOpActionState> {
  const user = await requireUser();
  try {
    const ids = await reconcileAll("manual", user.id);
    if (ids.length === 0) return { status: "error", message: "No hay equipos asignados a sedes activas." };
    await afterStart();
    return { status: "ok", ids };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** Aprobar/rechazar un freno de borrado masivo (sync_hold). Al aprobar se re-valida cada baja. */
export async function resolveSyncHoldAction(
  holdId: number,
  approve: boolean
): Promise<{ ok: boolean; message?: string; error?: string }> {
  const user = await requireUser();
  try {
    const { started } = await resolveSyncHold(holdId, approve, user.id);
    revalidatePath("/admin/dispositivos", "layout");
    return {
      ok: true,
      message: approve ? `Aprobado: ${started} baja(s) encolada(s).` : "Rechazado: no se borra a nadie.",
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Vista previa "X pierde acceso a Y" antes de guardar un cambio de alcance (docs/10 R8). Solo lectura. */
export async function previewImpactAction(change: ScopeChange): Promise<ImpactResult | { error: string }> {
  await requireUser();
  try {
    return await previewImpact(change);
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** "Sincronizar ahora" para una persona: corre el reconciliador en los equipos de su alcance y donde está vinculada. */
export async function syncEmployeeNowAction(_prev: MultiOpActionState, formData: FormData): Promise<MultiOpActionState> {
  const user = await requireUser();
  const employeeId = Number(formData.get("employee_id"));
  if (!Number.isInteger(employeeId)) return { status: "error", message: "Persona inválida." };
  try {
    const ids = await triggerReconcile(await devicesAffectedByEmployee(employeeId), "manual", user.id);
    if (ids.length === 0) {
      return { status: "error", message: "No hay equipos para sincronizar: la persona no tiene contratos vigentes con equipos asignados, ni vínculos activos." };
    }
    await afterStart();
    return { status: "ok", ids };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** "Sincronizar asistencia" de una empresa: pull de marcaciones de los equipos de sus sedes (docs/10 R11/R12). */
export async function syncCompanyAttendanceAction(_prev: MultiOpActionState, formData: FormData): Promise<MultiOpActionState> {
  await requireUser();
  const companyId = Number(formData.get("company_id"));
  if (!Number.isInteger(companyId)) return { status: "error", message: "Empresa inválida." };
  try {
    const devices = await prisma.devices.findMany({ where: { site: { company_id: companyId } }, select: { dev_id: true } });
    const ids = await attendancePullDevices(devices.map((d) => d.dev_id), "manual");
    if (ids.length === 0) return { status: "error", message: "La empresa no tiene equipos en sedes activas." };
    await afterStart();
    return { status: "ok", ids };
  } catch (err) {
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
