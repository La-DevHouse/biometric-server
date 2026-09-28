// The orchestration engine: reacts to a completed command by deciding what
// the parent operation does next — queue another step, verify, or finish.
// Invoked from lib/handlers/protocol-handlers.ts right after a command's
// result is stored, wrapped in a try/catch there so a bug here can never
// cost the device its HTTP 200 (the firmware does not retry send_cmd_result;
// losing that response loses the result forever).

import { decodeUserIdList, decodeLogData, resolveBinaryRef } from "@/lib/protocol";
import { runAsync, allAsync, getAsync, prisma, NOW_MS } from "@/lib/db";
import { TERMINAL_STAGES, OperationKind, MAX_FINGERPRINT_INDEX } from "./kinds";
import { getOperationRow, setStage, finishOperation, queueCommandForOperation, OperationRow } from "./queue";
import { insertAttendanceLogs, upsertUserFromInfo, UserInfoResult } from "./persist";
import { advanceAddEmployeesBatch } from "./batch";
import {
  ingestUserInfo,
  usedSlots,
  freeSlot,
  recordPropagatedSlot,
  patchTemplateUserId,
  MIN_TEMPLATE_BYTES,
} from "@/lib/fingerprints";

export interface AdvanceInput {
  opId: number;
  devId: string;
  transId: number;
  cmdCode: string;
  ok: boolean;
  returnCode: string;
  resultJson: Record<string, any> | null;
  binaries: Buffer[];
}

interface SyncUsersPlan {
  phase: "list" | "info";
  pending: string[];
  synced: string[];
  failed: Array<{ user_id: string; reason: string }>;
}

interface VerifyPlan {
  phase: "apply" | "verify";
  expected: string;
}

interface CreateUserPlan {
  phase: "probe" | "probe_list" | "create" | "verify" | "apply_privilege" | "verify_privilege";
  userName: string;
  privilege: string;
}

interface DeleteUserPlan {
  phase: "baseline" | "apply" | "verify";
  /** total_user_count del equipo antes de borrar — la verificación exige que baje exactamente 1. */
  baselineUsers?: number;
}

interface PushFingerprintPlan {
  phase: "apply" | "verify";
}

interface PushFingerprintParams {
  employeeId: number;
  fingerprintId: number; // employee_fingerprint.id (copia canónica)
  backupNumber: number; // slot LIBRE elegido en el destino (docs/05: un slot ocupado ignora la escritura)
}

interface AddEmployeeToDevicePlan {
  phase:
    | "baseline"
    | "verify_create_count"
    | "verify_push_count"
    | "probe"
    | "probe_list"
    | "create"
    | "verify_create"
    | "push"
    | "verify_push"
    | "apply_privilege"
    | "verify_privilege";
  candidateId: number;
  userName: string;
  privilege: string;
  /** employee_fingerprint.id pendientes de copiar (las "10 primeras", R10). */
  pendingFingerprints: number[];
  pushedFingerprints: number[];
  failedFingerprints: Array<{ fingerprintId: number; reason: string }>;
  currentFingerprint?: number;
  currentSlot?: number;
  /** La cédula ya existía en el equipo: se vinculó sin crear (docs/10 R5 / plan.md). */
  linkedExisting?: { deviceName: string };
  /** Totales del equipo (GET_DEVICE_STATUS) para verificar por conteo en vez de
   * releer con GET_USER_INFO (docs/10 O9). Sin valor = modo anterior (relectura). */
  baselineUsers?: number;
  fpBefore?: number;
  /** Frozen once the fingerprint chain ends, so the privilege phase can
   * append to the same summary instead of recomputing it blind. */
  fingerprintNote?: string;
  fingerprintMismatch?: boolean;
}

interface AddEmployeeToDeviceParams {
  employeeId: number;
}

export async function advanceOperationForCommand(input: AdvanceInput): Promise<void> {
  const op = await getOperationRow(input.opId);
  if (!op) {
    console.error(`[operations] advance: operación ${input.opId} no existe`);
    return;
  }

  // A command that finished after its operation was already closed (e.g. it
  // timed out and the sweep marked it error, then the device reported in
  // anyway) must not reopen it.
  if (TERMINAL_STAGES.has(op.stage)) return;

  // A late/duplicate result for a command that is no longer the operation's
  // current step.
  if (input.transId !== op.current_trans_id) {
    console.warn(
      `[operations] advance: trans ${input.transId} ya no es el paso actual de op ${op.id} (actual: ${op.current_trans_id})`
    );
    return;
  }

  await setStage(op.id, op.stage, { lastTransId: input.transId });

  // SYNC_USERS, CREATE_USER, RENAME_USER, CHANGE_PRIVILEGE and DELETE_USER
  // all handle failure themselves and must see it even when input.ok is
  // false:
  //   - SYNC_USERS records a per-user failure and keeps going.
  //   - CREATE_USER's probe step treats "GET_USER_INFO errored" as "no such
  //     user — the slot is free", the success path for a brand-new id.
  //   - RENAME_USER/CHANGE_PRIVILEGE's verify step reports a failed
  //     verification read as `mismatch` ("couldn't confirm"), not a generic
  //     `error` — the apply command itself already succeeded.
  //   - DELETE_USER's apply return code is not trustworthy at all (verified
  //     against real hardware: it reported "Error" on deletions that had
  //     actually succeeded), so it always verifies by re-querying the user
  //     regardless of what the apply step claimed.
  //   - PUSH_FINGERPRINT (SET_ENROLL_DATA) hasn't been caught lying the way
  //     DELETE_USER has, but nothing about this firmware's write commands has
  //     earned trust in their return code — verify regardless, same reasoning.
  //   - ADD_EMPLOYEE_TO_DEVICE combines CREATE_USER's probe (a failed
  //     GET_USER_INFO means the candidate id is free) with PUSH_FINGERPRINT's
  //     apply/verify shape for each queued finger — same reasoning as both.
  // Every other kind, and the apply phase of these, treats a failed command
  // as fatal.
  const SELF_HANDLED: OperationKind[] = [
    "SYNC_USERS",
    "CREATE_USER",
    "RENAME_USER",
    "CHANGE_PRIVILEGE",
    "DELETE_USER",
    "PUSH_FINGERPRINT",
    "ADD_EMPLOYEE_TO_DEVICE",
    "ADD_EMPLOYEES_BATCH",
    "RECONCILE_DEVICE",
  ];
  if (!input.ok && !SELF_HANDLED.includes(op.kind)) {
    await finishOperation(
      op.id,
      "error",
      `El equipo devolvió ${input.returnCode} al ejecutar ${input.cmdCode}.`
    );
    return;
  }

  switch (op.kind) {
    case "SYNC_CLOCK":
    case "RENAME_DEVICE":
    case "CLEAR_LOGS":
    case "CLEAR_ENROLL":
    case "VIEW_BIOMETRICS":
    case "REFRESH_STATUS":
      await advanceSimple(op, input);
      break;

    case "SYNC_USERS":
      await advanceSyncUsers(op, input);
      break;

    case "SYNC_LOGS":
      await advanceSyncLogs(op, input);
      break;

    case "RENAME_USER":
      await advanceVerified(op, input, "user_name");
      break;

    case "CHANGE_PRIVILEGE":
      await advanceVerified(op, input, "user_privilege");
      break;

    case "CREATE_USER":
      await advanceCreateUser(op, input);
      break;

    case "DELETE_USER":
      await advanceDeleteUser(op, input);
      break;

    case "CAPTURE_FINGERPRINT":
      await advanceCaptureFingerprint(op, input);
      break;

    case "PUSH_FINGERPRINT":
      await advancePushFingerprint(op, input);
      break;

    case "ADD_EMPLOYEE_TO_DEVICE":
      await advanceAddEmployeeToDevice(op, input);
      break;

    case "ADD_EMPLOYEES_BATCH":
      // Verifica por conteo o releyendo; los códigos de retorno de sus
      // escrituras no se usan (lib/operations/batch.ts).
      await advanceAddEmployeesBatch(op, input);
      break;

    case "RECONCILE_DEVICE": {
      // Import dinámico: lib/sync/reconcile arranca operaciones hijas vía
      // lib/operations/index.ts, que importa este archivo — estático sería un ciclo.
      const { advanceReconcile } = await import("@/lib/sync/reconcile");
      await advanceReconcile(op, input);
      break;
    }

    default:
      console.error(`[operations] advance: tipo de operación desconocido "${op.kind}"`);
      await finishOperation(op.id, "error", `Tipo de operación desconocido: ${op.kind}`);
  }
}

/** Single-command operations: one command, done on success. */
async function advanceSimple(op: OperationRow, input: AdvanceInput): Promise<void> {
  if (op.kind === "RENAME_DEVICE") {
    // Optimistic local write skipped deliberately — see the fk_name empty-
    // string quirk in protocol-handlers.ts. The device is the source of
    // truth and reports the new name on its own within ~10s.
    await finishOperation(op.id, "done", "El equipo confirmó el cambio de nombre.");
    return;
  }
  if (op.kind === "CLEAR_ENROLL") {
    // The device's local copy of enroll_data is now stale — never delete
    // attendance_logs here; that archive is independent of the device's
    // biometric memory.
    await runAsync(`DELETE FROM enroll_data WHERE dev_id = ?`, [op.dev_id]);
    await finishOperation(op.id, "done", "Biométricos borrados del equipo.");
    return;
  }
  if (op.kind === "CLEAR_LOGS") {
    // Deliberately does NOT touch local attendance_logs — the server is the
    // archive; clearing the device's memory is the whole point of this
    // action, not a reason to discard what's already synced.
    await finishOperation(op.id, "done", "Memoria de logs del equipo borrada.");
    return;
  }
  if (op.kind === "REFRESH_STATUS") {
    // handleCommandResult (protocol-handlers.ts) already persisted this via
    // upsertDeviceStatus for any GET_DEVICE_STATUS, before advance ever runs.
    await finishOperation(op.id, "done", "Estado del equipo actualizado.");
    return;
  }
  if (op.kind === "VIEW_BIOMETRICS") {
    // Same: handleCommandResult already upserted users/enroll_data for this
    // GET_USER_INFO. Only the summary note is built here.
    const entries = input.resultJson?.enroll_data_array as
      | Array<{ backup_number: number }>
      | undefined;
    const note = entries?.length
      ? `${entries.length} plantilla(s) registrada(s) (backup ${entries.map((e) => e.backup_number).join(", ")}).`
      : "Este usuario no tiene biométricos registrados.";
    await finishOperation(op.id, "done", note);
    return;
  }
  // SYNC_CLOCK
  await finishOperation(op.id, "done", "Reloj del equipo sincronizado con el servidor.");
}

async function advanceSyncUsers(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: SyncUsersPlan = op.plan_json
    ? JSON.parse(op.plan_json)
    : { phase: "list", pending: [], synced: [], failed: [] };

  if (plan.phase === "list") {
    // The list itself failing means the whole operation has nothing to work
    // with — this is fatal, unlike an individual GET_USER_INFO below.
    // Sin nadie con huella, el equipo responde ERROR_NO_USER en vez de una lista
    // vacía (equipo 2023054254, 2026-09-27): no es un fallo.
    if (!input.ok && input.returnCode === "ERROR_NO_USER") {
      await finishOperation(op.id, "done", "El equipo no tiene usuarios con huella registrada.");
      return;
    }
    if (!input.ok) {
      await finishOperation(op.id, "error", `El equipo devolvió ${input.returnCode} al listar usuarios.`);
      return;
    }
    const ids = input.ok ? decodeIdListOrEmpty(input.resultJson, input.binaries) : null;
    if (ids === null) {
      await finishOperation(op.id, "error", "No se pudo leer la lista de usuarios del equipo.");
      return;
    }
    if (ids.length === 0) {
      await finishOperation(op.id, "done", "El equipo no tiene usuarios registrados.");
      return;
    }
    const nextPlan: SyncUsersPlan = { phase: "info", pending: ids.slice(1), synced: [], failed: [] };
    await setStage(op.id, "waiting", { stepTotal: 1 + ids.length, stepIndex: 1, plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: ids[0] });
    return;
  }

  // phase === "info". The just-completed GET_USER_INFO's user row (if any)
  // was already upserted by handleCommandResult -> upsertUserFromInfo.
  // Recover the id this step was fetching from the command's own params,
  // since a failed command carries no resultJson.user_id to fall back on.
  const requestedId = await getCommandParamUserId(input.transId);
  const synced = input.ok ? [...plan.synced, input.resultJson?.user_id ?? requestedId] : plan.synced;
  const failed = input.ok
    ? plan.failed
    : [...plan.failed, { user_id: requestedId, reason: input.returnCode }];
  const pending = plan.pending;

  if (pending.length === 0) {
    const note =
      failed.length > 0
        ? `${synced.length} usuarios sincronizados, ${failed.length} con error.`
        : `${synced.length} usuarios sincronizados.`;
    const finalStage = failed.length > 0 && synced.length === 0 ? "error" : "done";
    await finishOperation(op.id, finalStage, note);
    // No local pruning here on purpose (a previous version deleted local
    // `users`/`enroll_data` rows not present in this list — reverted).
    // Verified against real hardware: GET_USER_ID_LIST does NOT enumerate
    // every user — it left out every USER-privilege / no-fingerprint-yet
    // account entirely (GET_DEVICE_STATUS reported 6 total users while this
    // command listed only the 3 with fingerprints). Pruning on "not in this
    // list" would have deleted real, still-existing accounts from the local
    // cache. DELETE_USER already cleans up its own row once verified —
    // that's the only safe place to remove a local user record.
    return;
  }

  const [nextId, ...rest] = pending;
  const nextPlan: SyncUsersPlan = { phase: "info", pending: rest, synced, failed };
  await setStage(op.id, "waiting", { stepIndex: op.step_index + 1, plan: nextPlan });
  await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: nextId });
}

/** The user_id a GET_USER_INFO command was queued for, read back from its own params. */
async function getCommandParamUserId(transId: number): Promise<string> {
  const row = await getAsync<{ cmd_param: string | null }>(
    `SELECT cmd_param FROM commands WHERE trans_id = ?`,
    [transId]
  );
  try {
    return row?.cmd_param ? JSON.parse(row.cmd_param).user_id ?? "desconocido" : "desconocido";
  } catch {
    return "desconocido";
  }
}

async function advanceSyncLogs(op: OperationRow, input: AdvanceInput): Promise<void> {
  // Un rango sin marcaciones (el pull diario, docs/10 §4.6) llega con
  // log_count 0 y sin binario: eso es "nada nuevo", no un error de lectura.
  const empty = Number(input.resultJson?.log_count) === 0;
  const entries = empty ? [] : input.resultJson ? decodeLogData(input.resultJson, input.binaries) : null;
  if (entries === null) {
    await finishOperation(op.id, "error", "No se pudo leer el historial del equipo.");
    return;
  }
  const summary = await insertAttendanceLogs(op.dev_id, entries);
  // Última sync EXITOSA de marcajes (≠ heartbeat last_seen_at) — docs/07 §1.6.
  await runAsync(`UPDATE devices SET last_sync_at = ${NOW_MS} WHERE dev_id = ?`, [op.dev_id]);
  // Resolver a quién pertenece cada marcaje por cédula (user_id = cédula, docs/10 §4.6).
  await runAsync(
    `UPDATE attendance_logs al SET employee_id = e.id
       FROM employee e
      WHERE al.dev_id = ? AND al.employee_id IS NULL
        AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id`,
    [op.dev_id]
  );
  const note =
    summary.total === 0
      ? "El equipo no reportó marcaciones."
      : `${summary.total} registros leídos del equipo: ${summary.inserted} nuevos, ${summary.skipped} ya estaban registrados.`;
  await finishOperation(op.id, "done", note);
}

/**
 * Shared shape for RENAME_USER and CHANGE_PRIVILEGE: apply, then verify with
 * a fresh GET_USER_INFO, because this firmware can return cmd_return_code:OK
 * for a change it silently didn't make (verified: SET_USER_PRIVILEGE with
 * "OPERATOR" — real hardware kept USER). `field` picks which key of the
 * GET_USER_INFO result to compare against what was requested.
 */
async function advanceVerified(
  op: OperationRow,
  input: AdvanceInput,
  field: "user_name" | "user_privilege"
): Promise<void> {
  const plan: VerifyPlan = op.plan_json
    ? JSON.parse(op.plan_json)
    : { phase: "apply", expected: "" };

  if (plan.phase === "apply") {
    // The apply command failing outright IS fatal — nothing to verify yet.
    if (!input.ok) {
      await finishOperation(
        op.id,
        "error",
        `El equipo devolvió ${input.returnCode} al ejecutar ${input.cmdCode}.`
      );
      return;
    }
    // SET_USER_NAME / SET_USER_PRIVILEGE often return OK with an empty body
    // (verified: trans 85 result_json was NULL) — there is nothing to
    // inspect in this response, only in the verification read that follows.
    await setStage(op.id, "verifying", { plan: { phase: "verify", expected: plan.expected } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: op.user_id });
    return;
  }

  // phase === "verify": a failed or empty verification read means the real
  // state is simply unknown — that's a `mismatch` to investigate, not a
  // generic `error`, since the apply step itself already reported success.
  if (!input.ok || !input.resultJson) {
    await finishOperation(
      op.id,
      "mismatch",
      "No se pudo verificar el cambio; el estado real del equipo es desconocido."
    );
    return;
  }
  const actual = field === "user_name" ? input.resultJson.user_name : input.resultJson.user_privilege;
  const expected = field === "user_name" ? plan.expected.slice(0, 8) : plan.expected;

  if (actual === expected) {
    const verb = field === "user_name" ? "nombre cambiado a" : "privilegio cambiado a";
    await finishOperation(op.id, "done", `${verb} "${expected}" (verificado en el equipo).`);
  } else {
    const noun = field === "user_name" ? "nombre" : "privilegio";
    await finishOperation(
      op.id,
      "mismatch",
      `El equipo respondió OK pero el ${noun} sigue siendo "${actual}" (se solicitó "${expected}"). ` +
        (field === "user_privilege"
          ? "Verificado contra hardware real: un privilegio elevado no se aplica mientras el usuario no " +
            "tenga ninguna huella registrada — registrale la huella físicamente y reintentá."
          : "")
    );
  }
}

/**
 * DELETE_USER's own cmd_return_code cannot be trusted in either direction —
 * verified against real hardware: deletions reported "Error" while the user
 * was actually gone, and (2026-09-26) one reported "Error" and really did
 * NOT delete. The verification can't rely on GET_USER_INFO either: it also
 * hangs, intermittently, for ids that DO exist (docs/10 §8 O9) — the old
 * "silence = gone" rule reported that failed deletion as "verified".
 *
 * So it brackets the delete with GET_DEVICE_STATUS, which has never hung:
 * total_user_count must drop by exactly one. Anything else — same count, a
 * different delta (someone enrolled/deleted at the keypad meanwhile), or an
 * unreadable status — is reported as mismatch, never as done.
 */
async function advanceDeleteUser(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: DeleteUserPlan = op.plan_json ? JSON.parse(op.plan_json) : { phase: "baseline" };

  if (plan.phase === "baseline") {
    const baselineUsers = totalUserCount(input);
    if (baselineUsers === null) {
      // Nothing destructive has been sent yet — failing here is safe.
      await finishOperation(
        op.id,
        "error",
        "No se pudo leer el estado del equipo antes de borrar; el borrado no se envió."
      );
      return;
    }
    await setStage(op.id, "waiting", { plan: { phase: "apply", baselineUsers } });
    await queueCommandForOperation(op.id, op.dev_id, "DELETE_USER", { user_id: op.user_id });
    return;
  }

  if (plan.phase === "apply") {
    // The apply result is ignored on purpose (see above) — only the count decides.
    await setStage(op.id, "verifying", { plan: { ...plan, phase: "verify" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
    return;
  }

  // phase === "verify"
  const after = totalUserCount(input);
  const before = plan.baselineUsers ?? null;
  if (after === null || before === null) {
    await finishOperation(
      op.id,
      "mismatch",
      "No se pudo leer el estado del equipo después del borrado; no se puede confirmar si se aplicó."
    );
    return;
  }
  if (after === before) {
    await finishOperation(
      op.id,
      "mismatch",
      `El usuario ${op.user_id} sigue existiendo en el equipo (sigue reportando ${after} usuarios); el borrado no se aplicó.`
    );
    return;
  }
  if (after !== before - 1) {
    await finishOperation(
      op.id,
      "mismatch",
      `El equipo pasó de ${before} a ${after} usuarios — no cuadra con un solo borrado (¿alguien agregó o ` +
        "borró usuarios en el equipo al mismo tiempo?). Revisá la lista antes de dar esto por hecho."
    );
    return;
  }

  await runAsync(`DELETE FROM users WHERE dev_id = ? AND user_id = ?`, [op.dev_id, op.user_id]);
  await runAsync(`DELETE FROM enroll_data WHERE dev_id = ? AND user_id = ?`, [op.dev_id, op.user_id]);
  // El usuario ya no existe en el equipo: su vínculo y sus slots registrados
  // tampoco (docs/10 §4.2). Las copias canónicas se conservan — si la persona
  // vuelve a entrar en el alcance, se re-propagan sin captura física.
  await prisma.employee_device_enrollment.updateMany({
    where: { dev_id: op.dev_id, device_user_id: String(op.user_id), status: "active" },
    data: { status: "inactive", ended_at: new Date() },
  });
  await prisma.device_fingerprint_slot.deleteMany({ where: { dev_id: op.dev_id, device_user_id: String(op.user_id) } });
  await finishOperation(op.id, "done", `Usuario ${op.user_id} eliminado del equipo (verificado).`);
}

/**
 * Captura manual: incorpora todo lo que el equipo reporta para este usuario
 * vía ingestUserInfo (lib/fingerprints.ts) — huellas nuevas → copia canónica +
 * slot `physical`; las ya conocidas (incluidas las que propagamos nosotros) no
 * se duplican. Nunca pide elegir un slot: el slot es orden de registro, no
 * identidad de dedo (verificado contra hardware real).
 */
async function advanceCaptureFingerprint(op: OperationRow, input: AdvanceInput): Promise<void> {
  const entries = (input.resultJson?.enroll_data_array as Array<{ backup_number: number }> | undefined)?.filter(
    (e) => e.backup_number >= 0 && e.backup_number <= MAX_FINGERPRINT_INDEX
  );
  if (!entries || entries.length === 0) {
    await finishOperation(op.id, "error", `El usuario ${op.user_id} no tiene huellas registradas en este equipo.`);
    return;
  }

  const result = await ingestUserInfo(
    op.dev_id,
    input.resultJson as { user_id?: string; enroll_data_array?: Array<{ backup_number: number }> },
    input.binaries
  );
  if (result.employeeId === null) {
    await finishOperation(
      op.id,
      "error",
      `El usuario ${op.user_id} no es la cédula de ningún empleado registrado — no se puede asociar su huella.`
    );
    return;
  }

  // Se guardan las huellas nuevas en el plan para que protocol-handlers.ts,
  // tras leer "done", dispare la sincronización de los demás equipos del
  // alcance (no se hace acá: importar lib/sync desde advance.ts crea un ciclo).
  await runAsync(`UPDATE operations SET plan_json = ? WHERE id = ?`, [
    JSON.stringify({ newFingerprintIds: result.newFingerprintIds, employeeId: result.employeeId }),
    op.id,
  ]);
  const n = result.newFingerprintIds.length;
  await finishOperation(
    op.id,
    "done",
    n === 0
      ? `Sin huellas nuevas: las ${entries.length} del equipo ya estaban registradas.`
      : `${n} huella(s) nueva(s) capturada(s) desde este equipo (slots ${entries.map((e) => e.backup_number).join(", ")}).`
  );
}

/**
 * Escribe una copia canónica en un slot LIBRE del destino (SET_ENROLL_DATA) y
 * la verifica releyendo: el cmd_return_code no es confiable, y sobre un slot
 * ocupado el equipo responde OK sin escribir nada (docs/05, T9b). Recién
 * verificada se registra el slot como `propagated` (lib/fingerprints.ts) — eso
 * es lo que impide que el reconciliador la vuelva a ingerir como huella nueva.
 */
async function advancePushFingerprint(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: PushFingerprintPlan = op.plan_json ? JSON.parse(op.plan_json) : { phase: "apply" };
  const params: PushFingerprintParams = op.params_json
    ? JSON.parse(op.params_json)
    : { employeeId: 0, fingerprintId: 0, backupNumber: -1 };

  if (plan.phase === "apply") {
    await setStage(op.id, "verifying", { plan: { phase: "verify" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: op.user_id });
    return;
  }

  // phase === "verify"
  const entries = input.resultJson?.enroll_data_array as Array<{ backup_number: number; enroll_data?: unknown }> | undefined;
  const entry = input.ok ? entries?.find((e) => e.backup_number === params.backupNumber) : undefined;
  const template = entry ? resolveBinaryRef(entry.enroll_data, input.binaries) : null;

  if (!template) {
    await finishOperation(
      op.id,
      "mismatch",
      `El equipo no reporta la huella en el slot ${params.backupNumber} del usuario ${op.user_id}. ` +
        "El firmware puede responder OK sin haber escrito (slot ocupado, o un fallo silencioso) — se reintenta en la próxima sincronización."
    );
    return;
  }

  await recordPropagatedSlot(op.dev_id, String(op.user_id), params.backupNumber, params.fingerprintId);
  await finishOperation(
    op.id,
    "done",
    `Huella copiada al slot ${params.backupNumber} del usuario ${op.user_id} y verificada en el equipo.`
  );
}

/**
 * Crea un empleado en un equipo nuevo, de punta a punta: sonda-con-reintento
 * para un ID libre (misma lógica de CREATE_USER, misma razón — GET_USER_INFO
 * es el único comando que realmente confirma "este id no existe"), crea el
 * usuario, vincula el enrolamiento, y si la persona ya tiene huellas
 * capturadas (employee_fingerprint) las copia una por una — mismo patrón
 * apply/verify de PUSH_FINGERPRINT, incluida la desconfianza en el
 * cmd_return_code de SET_ENROLL_DATA. Un fallo en una huella individual no
 * aborta las demás (igual que SYNC_USERS con GET_USER_INFO por usuario).
 */
async function advanceAddEmployeeToDevice(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: AddEmployeeToDevicePlan = op.plan_json
    ? JSON.parse(op.plan_json)
    : {
        phase: "probe",
        candidateId: 1,
        userName: "",
        privilege: "USER",
        pendingFingerprints: [],
        pushedFingerprints: [],
        failedFingerprints: [],
      };
  const params: AddEmployeeToDeviceParams = op.params_json
    ? JSON.parse(op.params_json)
    : { employeeId: 0 };

  if (plan.phase === "baseline") {
    // Punto de partida: los totales del equipo (GET_DEVICE_STATUS, que nunca se
    // colgó). Permiten verificar por conteo y, si la caché conoce a TODOS los
    // usuarios del equipo, saltarse la sonda GET_USER_INFO — el comando que en
    // producción deja al equipo mudo ~2 min cuando se cuelga (docs/10 O9).
    const users = totalUserCount(input);
    const fp = fingerprintCount(input);
    const id = String(plan.candidateId);
    if (users !== null && fp !== null) {
      const known = await prisma.users.findMany({ where: { dev_id: op.dev_id }, select: { user_id: true, user_name: true } });
      // ni uno de más ni de menos: la caché es el equipo. Y si la última revisión
      // nocturna no logró cuadrarla (hay usuarios que no conocemos), no se confía:
      // que coincidan las cantidades podría ser casualidad.
      const lastAudit = await prisma.$queryRaw<{ exact: string | null }[]>`
        SELECT stats->>'cache_exact' AS exact FROM sync_run
         WHERE dev_id = ${op.dev_id} AND kind = 'fingerprints' AND ok = true AND stats->>'audit' = 'true'
         ORDER BY started_at DESC LIMIT 1`;
      const cacheComplete = known.length === users && lastAudit[0]?.exact !== "false";
      const cachedSelf = known.find((u) => u.user_id === id);
      if (cacheComplete && !cachedSelf) {
        // Libre con certeza: no hay en el equipo ningún usuario que no conozcamos.
        const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "create", baselineUsers: users, fpBefore: fp };
        await setStage(op.id, "waiting", { plan: nextPlan });
        await queueCommandForOperation(op.id, op.dev_id, "SET_USER_INFO", {
          user_id: id,
          user_name: plan.userName,
          user_privilege: plan.privilege,
        });
        return;
      }
      const linked = cachedSelf
        ? await prisma.employee_device_enrollment.findFirst({
            where: { dev_id: op.dev_id, device_user_id: id, employee_id: params.employeeId, status: "active" },
            select: { id: true },
          })
        : null;
      if (cacheComplete && cachedSelf && linked) {
        // Ya está y ya está vinculada (completar huellas): nada que sondear.
        const pending = await missingOnDevice(plan.pendingFingerprints, op.dev_id, id);
        await advanceAddEmployeeToDevicePushNext(
          op,
          {
            ...plan,
            phase: "push",
            pendingFingerprints: pending,
            linkedExisting: { deviceName: cachedSelf.user_name ?? id },
            baselineUsers: users,
            fpBefore: fp,
          },
          params
        );
        return;
      }
    }
    // Caché incompleta o estado ilegible: la sonda de siempre.
    const nextPlan: AddEmployeeToDevicePlan = {
      ...plan,
      phase: "probe",
      baselineUsers: users ?? undefined,
      fpBefore: fp ?? undefined,
    };
    await setStage(op.id, "waiting", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: id });
    return;
  }

  if (plan.phase === "probe") {
    // El candidato es la cédula del empleado (docs/09 D4, docs/10 R5). Si ya
    // hay un usuario con esa cédula en el equipo, ES esta persona — la
    // vinculación es automática por cédula (plan.md), no una colisión. Se
    // vincula SIN SET_USER_INFO (sobre un usuario existente dispara el
    // reindexado destructivo, docs/05) y sin tocar sus huellas: las que ya
    // tenga se incorporan al registro (ingestUserInfo) y solo se copian las
    // que le falten.
    const existingName = input.ok ? input.resultJson?.user_name : null;
    if (existingName) {
      const info = input.resultJson as UserInfoResult;
      await upsertUserFromInfo(op.dev_id, info, input.binaries);
      await ingestUserInfo(op.dev_id, info as { user_id?: string; enroll_data_array?: Array<{ backup_number: number }> }, input.binaries);
      await ensureLinked(params.employeeId, op.dev_id, String(plan.candidateId));
      const pending = await missingOnDevice(plan.pendingFingerprints, op.dev_id, String(plan.candidateId));
      await advanceAddEmployeeToDevicePushNext(
        op,
        { ...plan, phase: "push", pendingFingerprints: pending, linkedExisting: { deviceName: String(existingName) } },
        params
      );
      return;
    }
    // Silencio/vacío: no alcanza para dar la cédula por libre (O9) — ver probeListVerdict.
    await setStage(op.id, "waiting", { plan: { ...plan, phase: "probe_list" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_ID_LIST", {});
    return;
  }

  if (plan.phase === "probe_list") {
    const refusal = probeListVerdict(input, String(plan.candidateId));
    if (refusal) {
      await finishOperation(op.id, "error", refusal);
      return;
    }
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "create" };
    await setStage(op.id, "waiting", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "SET_USER_INFO", {
      user_id: String(plan.candidateId),
      user_name: plan.userName,
      user_privilege: plan.privilege,
    });
    return;
  }

  if (plan.phase === "create") {
    // SET_USER_INFO puede devolver OK con cuerpo vacío (mismo comportamiento
    // verificado en CREATE_USER): no se le cree. Con línea de base, se confirma
    // porque el total de usuarios sube exactamente 1 (como DELETE_USER al revés).
    if (plan.baselineUsers !== undefined) {
      const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_create_count" };
      await setStage(op.id, "verifying", { plan: nextPlan });
      await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
      return;
    }
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_create" };
    await setStage(op.id, "verifying", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: String(plan.candidateId) });
    return;
  }

  if (plan.phase === "verify_create_count") {
    const after = totalUserCount(input);
    const id = String(plan.candidateId);
    if (after !== null && plan.baselineUsers !== undefined && after === plan.baselineUsers + 1) {
      // Creado. Se anota en la caché lo que se escribió (lo que antes dejaba la relectura).
      await runAsync(
        `INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, ?, ?, 'USER')
         ON CONFLICT(dev_id, user_id) DO UPDATE SET user_name = excluded.user_name`,
        [op.dev_id, id, plan.userName]
      );
      await ensureLinked(params.employeeId, op.dev_id, id);
      await advanceAddEmployeeToDevicePushNext(
        op,
        { ...plan, phase: "push", baselineUsers: after, fpBefore: fingerprintCount(input) ?? plan.fpBefore },
        params
      );
      return;
    }
    // El conteo no cierra (algo cambió en el equipo a la vez, o no se leyó): la
    // relectura de siempre decide, y el resto de la operación sigue en ese modo.
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_create", baselineUsers: undefined, fpBefore: undefined };
    await setStage(op.id, "verifying", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: id });
    return;
  }

  if (plan.phase === "verify_push_count") {
    const fingerprintId = plan.currentFingerprint ?? -1;
    const slot = plan.currentSlot ?? -1;
    const userId = String(plan.candidateId);
    const fp = fingerprintCount(input);
    const before = plan.fpBefore;
    if (fp === null || before === undefined || (fp !== before + 1 && fp !== before)) {
      // No cierra con una sola huella escrita: releer, como antes.
      const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_push", baselineUsers: undefined, fpBefore: undefined };
      await setStage(op.id, "verifying", { plan: nextPlan });
      await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: userId });
      return;
    }
    const wasWritten = fp === before + 1; // igual = OK sin escribir (slot ocupado, T9b)
    if (wasWritten) {
      await recordPropagatedSlot(op.dev_id, userId, slot, fingerprintId);
      const fingerprint = await prisma.employee_fingerprint.findUnique({ where: { id: fingerprintId }, select: { template: true } });
      if (fingerprint) {
        await runAsync(
          `INSERT INTO enroll_data (dev_id, user_id, backup_number, data) VALUES (?, ?, ?, ?)
           ON CONFLICT(dev_id, user_id, backup_number) DO UPDATE SET data = excluded.data`,
          [op.dev_id, userId, slot, patchTemplateUserId(fingerprint.template, userId)]
        );
      }
    }
    await advanceAddEmployeeToDevicePushNext(
      op,
      {
        ...plan,
        phase: "push",
        fpBefore: fp,
        pushedFingerprints: wasWritten ? [...plan.pushedFingerprints, fingerprintId] : plan.pushedFingerprints,
        failedFingerprints: wasWritten
          ? plan.failedFingerprints
          : [...plan.failedFingerprints, { fingerprintId, reason: `el equipo no la escribió en el slot ${slot} (sin cambio en su total de huellas)` }],
      },
      params
    );
    return;
  }

  if (plan.phase === "verify_create") {
    if (!input.ok || !input.resultJson?.user_name) {
      await finishOperation(
        op.id,
        "mismatch",
        "No se pudo verificar la creación del usuario; el estado real del equipo es desconocido."
      );
      return;
    }
    await upsertUserFromInfo(op.dev_id, input.resultJson as UserInfoResult, input.binaries);
    await ensureLinked(params.employeeId, op.dev_id, String(plan.candidateId));
    await advanceAddEmployeeToDevicePushNext(op, { ...plan, phase: "push" }, params);
    return;
  }

  if (plan.phase === "push") {
    // Igual que PUSH_FINGERPRINT: el cmd_return_code de SET_ENROLL_DATA no
    // es confiable en ninguna dirección — siempre se verifica. Con línea de
    // base, por el total de huellas del equipo (+1 = escrita; igual = no la
    // escribió, T9b); si no, releyendo como antes.
    if (plan.fpBefore !== undefined) {
      const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_push_count" };
      await setStage(op.id, "verifying", { plan: nextPlan });
      await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
      return;
    }
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_push" };
    await setStage(op.id, "verifying", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: String(plan.candidateId) });
    return;
  }

  if (plan.phase === "verify_push") {
    const fingerprintId = plan.currentFingerprint ?? -1;
    const slot = plan.currentSlot ?? -1;
    const entries = input.resultJson?.enroll_data_array as Array<{ backup_number: number }> | undefined;
    const wasWritten = input.ok && !!entries?.some((e) => e.backup_number === slot);
    if (wasWritten) await recordPropagatedSlot(op.dev_id, String(plan.candidateId), slot, fingerprintId);

    await advanceAddEmployeeToDevicePushNext(
      op,
      {
        ...plan,
        phase: "push",
        pushedFingerprints: wasWritten ? [...plan.pushedFingerprints, fingerprintId] : plan.pushedFingerprints,
        failedFingerprints: wasWritten
          ? plan.failedFingerprints
          : [
              ...plan.failedFingerprints,
              { fingerprintId, reason: input.ok ? `no reportada en el slot ${slot} tras la escritura` : input.returnCode },
            ],
      },
      params
    );
    return;
  }

  if (plan.phase === "apply_privilege") {
    // Igual que CHANGE_PRIVILEGE: SET_USER_PRIVILEGE puede devolver OK sin
    // haber aplicado nada — la única confirmación real es releer.
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_privilege" };
    await setStage(op.id, "verifying", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: String(plan.candidateId) });
    return;
  }

  // phase === "verify_privilege"
  const fingerprintNote = plan.fingerprintNote ?? summarizeAddEmployeeToDevice(plan);
  const actualPrivilege = input.ok ? input.resultJson?.user_privilege : undefined;

  if (actualPrivilege === plan.privilege) {
    await finishOperation(
      op.id,
      plan.fingerprintMismatch ? "mismatch" : "done",
      `${fingerprintNote} Privilegio "${plan.privilege}" verificado en el equipo.`
    );
    return;
  }

  // Verificado contra hardware real (2026-09-08): un privilegio elevado no
  // se aplica mientras el usuario no tenga ninguna huella registrada — el
  // equipo responde OK pero lo deja en USER. Si esta operación no logró
  // copiar ninguna huella, esa es casi con certeza la causa.
  const reason =
    plan.pushedFingerprints.length === 0
      ? "no se pudo aplicar todavía — este firmware solo acepta privilegios elevados una vez que el " +
        'usuario tiene al menos una huella registrada. Volvé a intentar "Cambiar privilegio" después de ' +
        "registrarle la huella."
      : `el equipo respondió OK pero el privilegio sigue siendo "${actualPrivilege ?? "desconocido"}".`;
  await finishOperation(op.id, "mismatch", `${fingerprintNote} Privilegio "${plan.privilege}" ${reason}`);
}

/**
 * Verificado contra hardware real (2026-09-08): `SET_USER_INFO` no aplica su
 * campo `user_privilege` de forma confiable al crear (un usuario recién
 * creado con `"MANAGER"` quedó reportado como `USER`), y `SET_USER_PRIVILEGE`
 * — normalmente confiable para `MANAGER` — tampoco lo aplica mientras el
 * usuario no tenga ninguna huella registrada: el equipo respondió `OK` sin
 * error pero el privilegio se quedó en `USER`, y volvió a funcionar apenas
 * hubo una huella. Por eso esto corre SIEMPRE al final, después de copiar
 * cualquier huella ya capturada — nunca antes.
 */
async function advanceAddEmployeeToDeviceFinishOrElevate(
  op: OperationRow,
  plan: AddEmployeeToDevicePlan
): Promise<void> {
  if (plan.privilege === "USER") {
    await finishOperation(
      op.id,
      plan.fingerprintMismatch ? "mismatch" : "done",
      plan.fingerprintNote ?? summarizeAddEmployeeToDevice(plan)
    );
    return;
  }
  const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "apply_privilege" };
  await setStage(op.id, "waiting", { plan: nextPlan });
  await queueCommandForOperation(op.id, op.dev_id, "SET_USER_PRIVILEGE", {
    user_id: String(plan.candidateId),
    user_privilege: plan.privilege,
  });
}

/** Vincula (dev, cédula) ↔ empleado si todavía no lo está (docs/10 R5). */
async function ensureLinked(employeeId: number, devId: string, userId: string): Promise<void> {
  const existing = await prisma.employee_device_enrollment.findFirst({
    where: { dev_id: devId, device_user_id: userId, status: "active" },
    select: { id: true },
  });
  if (!existing) {
    await prisma.employee_device_enrollment.create({
      data: { employee_id: employeeId, dev_id: devId, device_user_id: userId },
    });
  }
}

/** De estas copias canónicas, las que todavía no están en ningún slot de (dev, user). */
async function missingOnDevice(fingerprintIds: number[], devId: string, userId: string): Promise<number[]> {
  if (fingerprintIds.length === 0) return [];
  const present = await prisma.device_fingerprint_slot.findMany({
    where: { dev_id: devId, device_user_id: userId, fingerprint_id: { in: fingerprintIds } },
    select: { fingerprint_id: true },
  });
  const have = new Set(present.map((p) => p.fingerprint_id));
  return fingerprintIds.filter((id) => !have.has(id));
}

/** Toma la siguiente huella pendiente y la escribe en un slot LIBRE, o pasa a
 * aplicar el privilegio (o cierra la operación) si ya no quedan. */
async function advanceAddEmployeeToDevicePushNext(
  op: OperationRow,
  plan: AddEmployeeToDevicePlan,
  params: AddEmployeeToDeviceParams
): Promise<void> {
  if (plan.pendingFingerprints.length === 0) {
    const fingerprintMismatch = plan.pushedFingerprints.length === 0 && plan.failedFingerprints.length > 0;
    await advanceAddEmployeeToDeviceFinishOrElevate(op, {
      ...plan,
      fingerprintNote: summarizeAddEmployeeToDevice(plan),
      fingerprintMismatch,
    });
    return;
  }

  const [fingerprintId, ...rest] = plan.pendingFingerprints;
  const userId = String(plan.candidateId);
  const fingerprint = await prisma.employee_fingerprint.findUnique({ where: { id: fingerprintId } });
  const slot = freeSlot(await usedSlots(op.dev_id, userId));
  const failure =
    !fingerprint || fingerprint.template.length < MIN_TEMPLATE_BYTES
      ? "plantilla local inválida o ausente"
      : slot === null
        ? "los 10 slots del usuario ya están ocupados en este equipo"
        : null;
  if (failure || !fingerprint || slot === null) {
    await advanceAddEmployeeToDevicePushNext(
      op,
      {
        ...plan,
        pendingFingerprints: rest,
        failedFingerprints: [...plan.failedFingerprints, { fingerprintId, reason: failure ?? "desconocido" }],
      },
      params
    );
    return;
  }

  const nextPlan: AddEmployeeToDevicePlan = {
    ...plan,
    phase: "push",
    pendingFingerprints: rest,
    currentFingerprint: fingerprintId,
    currentSlot: slot,
  };
  await setStage(op.id, "waiting", { plan: nextPlan });
  await queueCommandForOperation(
    op.id,
    op.dev_id,
    "SET_ENROLL_DATA",
    { user_id: userId, backup_number: slot, enroll_data: "BIN_1" },
    patchTemplateUserId(fingerprint.template, userId)
  );
}

function summarizeAddEmployeeToDevice(plan: AddEmployeeToDevicePlan): string {
  const head = plan.linkedExisting
    ? `El usuario ${plan.candidateId} ya existía en el equipo ("${plan.linkedExisting.deviceName}"): vinculado por cédula, sin tocar su ficha.`
    : `Usuario ${plan.candidateId} creado y vinculado (verificado).`;
  const total = plan.pushedFingerprints.length + plan.failedFingerprints.length;
  if (total === 0) {
    return plan.linkedExisting
      ? `${head} No le faltaba ninguna huella.`
      : `${head} Sin huellas capturadas todavía para copiar.`;
  }
  const base = `${head} ${plan.pushedFingerprints.length} de ${total} huella(s) copiada(s) y verificada(s).`;
  return plan.failedFingerprints.length > 0
    ? `${base} Fallaron: ${plan.failedFingerprints.map((f) => f.reason).join("; ")}.`
    : base;
}

/** `user_id_count: 0` means an empty roster — decodeUserIdList itself would
 * see a zero-length binary and return null (indistinguishable from a real
 * decode failure), so that case is special-cased here before delegating. */
function decodeIdListOrEmpty(resultJson: Record<string, any> | null, binaries: Buffer[]): string[] | null {
  if (resultJson?.user_id_count === 0) return [];
  return decodeUserIdList(resultJson, binaries);
}

/** fp_count de un GET_DEVICE_STATUS, o null si no se pudo leer. */
function fingerprintCount(input: AdvanceInput): number | null {
  if (!input.ok) return null;
  const n = Number(input.resultJson?.fp_count);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** total_user_count de un GET_DEVICE_STATUS (llega como string), o null si no se pudo leer. */
function totalUserCount(input: AdvanceInput): number | null {
  if (!input.ok) return null;
  const n = Number(input.resultJson?.total_user_count);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Segunda opinión antes de creer que un ID está libre (docs/10 §8 O9). La
 * sonda GET_USER_INFO no respondió — pero verificado en hardware real
 * (2023081133, 2026-09-26) que ese silencio también ocurre, de forma
 * intermitente, con ids que SÍ existen. GET_USER_ID_LIST no enumera a los
 * usuarios sin huella, así que no sirve para decir "libre"; sí sirve para lo
 * contrario: si el id aparece, existe Y tiene huellas — justo el caso donde
 * SET_USER_INFO dispara el reindexado destructivo. Si no aparece, lo peor
 * posible es un usuario sin huellas, que no tiene huellas que perder.
 *
 * Devuelve null si se puede crear, o el motivo para no hacerlo.
 */
function probeListVerdict(input: AdvanceInput, candidateId: string): string | null {
  // ERROR_NO_USER = nadie tiene huella en el equipo (lista vacía, 2023054254): el ID
  // no figura en la lista, igual que con cualquier otra lista que no lo trae.
  const ids = input.ok
    ? decodeIdListOrEmpty(input.resultJson, input.binaries)
    : input.returnCode === "ERROR_NO_USER"
      ? []
      : null;
  if (ids === null) {
    return (
      `No se pudo confirmar que el ID ${candidateId} esté libre (el equipo no devolvió su lista de usuarios). ` +
      "No se crea para no pisar un usuario existente; reintentá en unos minutos."
    );
  }
  if (ids.includes(candidateId)) {
    return (
      `El usuario ${candidateId} ya existe en el equipo con huellas registradas, aunque no respondió a la ` +
      "consulta. No se crea encima: destruiría sus huellas. Reintentá en unos minutos para ver sus datos."
    );
  }
  return null;
}

async function advanceCreateUser(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: CreateUserPlan = op.plan_json
    ? JSON.parse(op.plan_json)
    : { phase: "probe", userName: "", privilege: "USER" };

  if (plan.phase === "probe") {
    // Probes with GET_USER_INFO for this exact id, not GET_USER_ID_LIST.
    // Tried the id-list route first as a way to dodge GET_USER_INFO's
    // occasional hang on real hardware — that was wrong: verified against
    // real hardware, GET_USER_ID_LIST does NOT enumerate every user. It
    // silently excludes USER-privilege / no-fingerprint-yet accounts
    // entirely (GET_DEVICE_STATUS reported 6 total users while it listed
    // only the 3 with fingerprints). Using it as an existence check would
    // let CREATE_USER "safely" run SET_USER_INFO over an id that's already
    // taken but just has no fingerprint yet — exactly the case that
    // triggers the destructive reindex (see the SET_USER_INFO warning
    // above). GET_USER_INFO answering slowly sometimes is a real cost, but
    // it is the only command that actually answers "does this id exist" —
    // the cancel button and the stale-sweep exist precisely to bound that
    // cost. A command error, or OK with no user_name, is NOT taken as "free"
    // on its own anymore — see probeListVerdict (docs/10 §8 O9).
    const existingName = input.ok ? input.resultJson?.user_name : null;
    if (existingName) {
      await finishOperation(
        op.id,
        "error",
        `Ya existe el usuario ${op.user_id} ("${existingName}") en el equipo. ` +
          `Usa Renombrar o Cambiar privilegio; crear encima destruiría sus huellas.`
      );
      return;
    }
    await setStage(op.id, "waiting", { plan: { ...plan, phase: "probe_list" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_ID_LIST", {});
    return;
  }

  if (plan.phase === "probe_list") {
    const refusal = probeListVerdict(input, String(op.user_id));
    if (refusal) {
      await finishOperation(op.id, "error", refusal);
      return;
    }
    await setStage(op.id, "waiting", { plan: { ...plan, phase: "create" } });
    await queueCommandForOperation(op.id, op.dev_id, "SET_USER_INFO", {
      user_id: op.user_id,
      user_name: plan.userName,
      user_privilege: plan.privilege,
    });
    return;
  }

  if (plan.phase === "create") {
    // SET_USER_INFO's own return code has not been caught lying (unlike
    // DELETE_USER's), but it can return OK with an empty body the same way
    // SET_USER_NAME/SET_USER_PRIVILEGE do, so there's nothing reliable to
    // read here either way — verify with a real GET_USER_INFO afterward.
    // At this point the id is expected to exist (we just tried to create
    // it), which is the case GET_USER_INFO answers fast and reliably.
    await setStage(op.id, "verifying", { plan: { ...plan, phase: "verify" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: op.user_id });
    return;
  }

  if (plan.phase === "verify") {
    if (!input.ok || !input.resultJson?.user_name) {
      await finishOperation(
        op.id,
        "mismatch",
        "No se pudo verificar la creación; el estado real del equipo es desconocido."
      );
      return;
    }
    // Persist exactly what the device confirmed, not just what was requested
    // — handleCommandResult already does this for ad-hoc GET_USER_INFO calls,
    // but that path doesn't run for commands that belong to an operation.
    await upsertUserFromInfo(op.dev_id, input.resultJson as UserInfoResult, input.binaries);

    if (plan.privilege === "USER") {
      await finishOperation(
        op.id,
        "done",
        `Usuario ${op.user_id} creado y verificado. Registra su huella físicamente en el equipo.`
      );
      return;
    }
    // Verificado contra hardware real (2026-09-08, ver ADD_EMPLOYEE_TO_DEVICE
    // más abajo y docs/05-commands-catalog.md → SET_USER_PRIVILEGE): un
    // privilegio elevado pedido en el propio SET_USER_INFO de creación se
    // ignora — el usuario queda en USER pase lo que pase. Solo un
    // SET_USER_PRIVILEGE aparte, DESPUÉS de que el usuario ya exista, tiene
    // chance de aplicarlo (y ni así, si todavía no tiene huella registrada).
    await setStage(op.id, "waiting", { plan: { ...plan, phase: "apply_privilege" } });
    await queueCommandForOperation(op.id, op.dev_id, "SET_USER_PRIVILEGE", {
      user_id: op.user_id,
      user_privilege: plan.privilege,
    });
    return;
  }

  if (plan.phase === "apply_privilege") {
    // Misma desconfianza que CHANGE_PRIVILEGE: puede devolver OK sin haber
    // aplicado nada — solo una relectura confirma de verdad.
    await setStage(op.id, "verifying", { plan: { ...plan, phase: "verify_privilege" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: op.user_id });
    return;
  }

  // phase === "verify_privilege"
  const actualPrivilege = input.ok ? input.resultJson?.user_privilege : undefined;
  if (actualPrivilege === plan.privilege) {
    await finishOperation(
      op.id,
      "done",
      `Usuario ${op.user_id} creado con privilegio "${plan.privilege}" (verificado en el equipo).`
    );
    return;
  }
  // Verificado contra hardware real (2026-09-08): un privilegio elevado no
  // se aplica mientras el usuario no tenga ninguna huella registrada — el
  // equipo responde OK pero lo deja en USER. Como CREATE_USER no copia
  // huellas por sí mismo (a diferencia de ADD_EMPLOYEE_TO_DEVICE), esta es
  // la explicación casi segura cada vez que este paso no verifica.
  await finishOperation(
    op.id,
    "mismatch",
    `Usuario ${op.user_id} creado, pero el privilegio "${plan.privilege}" no se pudo aplicar todavía — ` +
      "este firmware solo acepta privilegios elevados una vez que el usuario tiene al menos una huella " +
      'registrada. Registrale la huella físicamente y volvé a intentar "Cambiar privilegio".'
  );
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
/** Sin consultar hace más de esto = el equipo no está (una consulta cada ~11 s; O9 lo calla ~2 min). */
const DEVICE_GONE_MS = 5 * 60 * 1000;
const THREE_MINUTES_MS = 3 * 60 * 1000;

/**
 * "verifying"-stage commands are quick reads (GET_USER_INFO for
 * RENAME_USER/CHANGE_PRIVILEGE/CREATE_USER, GET_DEVICE_STATUS for
 * DELETE_USER) that normally answer in seconds, so a short timeout bounds
 * the wait. A timeout here always resolves as "couldn't confirm" (mismatch),
 * never as success: silence used to count as DELETE_USER's success path,
 * but verified on hardware (2026-09-26, docs/10 §8 O9) GET_USER_INFO also
 * hangs, intermittently, for ids that DO exist — that rule reported a
 * failed deletion as verified.
 */
const VERIFY_TIMEOUT_MS = 25 * 1000;

// CREATE_USER and ADD_EMPLOYEE_TO_DEVICE both open with a "probe": a
// GET_USER_INFO against a candidate id that has never existed before, sent
// BEFORE anything is known about whether the device is even reachable. A
// silent device that hasn't even polled yet (still 'queued'/'waiting') must
// still get the full grace period below — that silence means nothing yet.
// But verified repeatedly against real hardware (device 2023081133,
// 2026-08-18, re-confirmed live 2026-09-08): once the probe is actually
// delivered (stage 'sent') and the device genuinely has no such user, it
// NEVER sends a result at all — not slowly, not eventually — while querying
// an id that DOES exist always answers within seconds. So a 'sent'-stage
// probe's silence carries the same hang-means-free signal as DELETE_USER's
// verify hang-means-gone, and a real collision (id taken) resolves almost
// immediately regardless — there's no reason to make every genuinely free
// id sit out the generic THREE_MINUTES_MS 'sent' timeout, so this gets its
// own short window instead (see PROBE_TIMEOUT_MS). Update 2026-09-26 (O9):
// that silence also happens, intermittently, for ids that DO exist, so it
// is no longer the final word — it only moves the probe on to the
// GET_USER_ID_LIST cross-check (probeListVerdict).
const PROBE_PHASE_KINDS: ReadonlySet<OperationKind> = new Set(["CREATE_USER", "ADD_EMPLOYEE_TO_DEVICE"]);

const PROBE_TIMEOUT_MS = 30 * 1000;

function isPendingProbe(op: OperationRow): boolean {
  if (!PROBE_PHASE_KINDS.has(op.kind) || op.stage !== "sent") return false;
  try {
    const plan = op.plan_json ? JSON.parse(op.plan_json) : null;
    return plan?.phase === "probe";
  } catch {
    return false;
  }
}

/**
 * Lazy expiry: no cron in this stack, so this runs on the device's own poll
 * heartbeat (handleReceiveCmd, ~every 10s) and from the operations list
 * queries, which covers a device that never comes back to poll at all.
 * Expires BOTH the stuck command (so a stale WAIT can't resurrect a closed
 * operation hours later) and the operation itself.
 */
export async function sweepStaleOperations(): Promise<number> {
  const now = Date.now();
  const candidates = await allAsync<OperationRow & { device_last_seen_at: number | null }>(
    `SELECT o.*, d.last_seen_at AS device_last_seen_at
       FROM operations o
       LEFT JOIN devices d ON d.dev_id = o.dev_id
      WHERE o.stage IN ('queued','sent','waiting','verifying')`
  );
  const activePerDevice = new Map<string, number>();
  for (const op of candidates) activePerDevice.set(op.dev_id, (activePerDevice.get(op.dev_id) ?? 0) + 1);

  let expired = 0;
  for (const op of candidates) {
    const age = now - op.updated_at;
    if (op.stage === "queued") {
      // Nunca entregada. Si hay otra operación del mismo equipo en curso, espera
      // su turno (candado por equipo, protocol-handlers): con el equipo
      // consultando eso no es "colgada" y se le da hasta 1 h. Sola, o con el
      // equipo sin consultar, vence a los 10 min como siempre.
      const deviceGone = !op.device_last_seen_at || now - op.device_last_seen_at > DEVICE_GONE_MS;
      const waitingTurn = !deviceGone && (activePerDevice.get(op.dev_id) ?? 0) > 1;
      if (age < (waitingTurn ? ONE_HOUR_MS : TEN_MINUTES_MS)) continue;
      if (op.current_trans_id) {
        await runAsync(
          `UPDATE commands SET status = 'ERROR', cmd_return_code = 'TIMEOUT', updated_at = ${NOW_MS}
            WHERE trans_id = ? AND status IN ('WAIT','RUN')`,
          [op.current_trans_id]
        );
      }
      await finishOperation(op.id, "error", "El equipo no respondió a tiempo; la operación se canceló.");
      expired++;
      continue;
    }
    const isVerifying = op.stage === "verifying";
    const pendingProbe = isPendingProbe(op);
    const threshold = isVerifying
      ? VERIFY_TIMEOUT_MS
      : pendingProbe
        ? PROBE_TIMEOUT_MS
        : op.stage === "sent"
          ? THREE_MINUTES_MS
          : TEN_MINUTES_MS;
    if (age < threshold) continue;

    const transId = op.current_trans_id;
    if (transId) {
      await runAsync(
        `UPDATE commands SET status = 'ERROR', cmd_return_code = 'TIMEOUT',
                updated_at = ${NOW_MS}
          WHERE trans_id = ? AND status IN ('WAIT','RUN')`,
        [transId]
      );
    }

    if ((isVerifying || pendingProbe) && transId) {
      // Route through the normal per-kind handler as if the device had
      // reported failure, instead of a generic timeout error.
      // Every verify (RENAME_USER/CHANGE_PRIVILEGE/CREATE_USER/DELETE_USER)
      // turns that into "mismatch" — cannot confirm, don't claim success.
      // CREATE_USER/ADD_EMPLOYEE_TO_DEVICE's probe moves on to the
      // GET_USER_ID_LIST cross-check (probeListVerdict) instead of taking the
      // silence as "free" by itself (O9).
      try {
        await advanceOperationForCommand({
          opId: op.id,
          devId: op.dev_id,
          transId,
          cmdCode: "GET_USER_INFO",
          ok: false,
          returnCode: "TIMEOUT",
          resultJson: null,
          binaries: [],
        });
        expired++;
        continue;
      } catch (err) {
        console.error("[operations] fallo al resolver un timeout de verificación:", op.id, err);
        // Falls through to the generic error path below.
      }
    }

    await finishOperation(op.id, "error", "El equipo no respondió a tiempo; la operación se canceló.");
    expired++;
  }
  return expired;
}
