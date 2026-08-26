"use server";

import { revalidatePath } from "next/cache";
import { initDb, runAsync } from "@/lib/db";
import { COMMAND_TEMPLATES } from "@/lib/commandTemplates";
import {
  startSyncClock,
  startRenameDevice,
  startSyncUsers,
  startRenameUser,
  startChangePrivilege,
  startCreateUser,
  startDeleteUser,
  startSyncLogs,
  startClearLogs,
  startClearEnrollData,
  startViewBiometrics,
  startRefreshStatus,
  cancelOperation,
  type Privilege,
} from "@/lib/operations";
import type { OpActionState } from "@/lib/opActionState";

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
      `INSERT INTO commands (dev_id, cmd_code, cmd_param, status) VALUES (?, ?, ?, 'WAIT')`,
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
// polling de OpTracker (app/api/operations) es lo que refleja el progreso
// real de 10-40s; estas actions solo encolan y devuelven de inmediato.
// ---------------------------------------------------------------------------

function opError(err: unknown): OpActionState {
  return { status: "error", message: err instanceof Error ? err.message : String(err) };
}

async function afterStart(): Promise<void> {
  await initDb();
  revalidatePath("/admin", "layout");
}

export async function syncClockAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
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

export async function createUserAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
  const devId = String(formData.get("dev_id") || "");
  const userId = String(formData.get("user_id") || "");
  const userName = String(formData.get("user_name") || "");
  const privilege = (String(formData.get("user_privilege") || "USER")) as Privilege;
  try {
    const { id, warning } = await startCreateUser(devId, { userId, userName, privilege });
    await afterStart();
    return { status: "ok", id, warning };
  } catch (err) {
    return opError(err);
  }
}

export async function deleteUserAction(_prev: OpActionState, formData: FormData): Promise<OpActionState> {
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
  const result = await cancelOperation(id);
  revalidatePath("/admin", "layout");
  return result;
}
