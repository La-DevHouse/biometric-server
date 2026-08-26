// The orchestration engine: reacts to a completed command by deciding what
// the parent operation does next — queue another step, verify, or finish.
// Invoked from lib/handlers/protocol-handlers.ts right after a command's
// result is stored, wrapped in a try/catch there so a bug here can never
// cost the device its HTTP 200 (the firmware does not retry send_cmd_result;
// losing that response loses the result forever).

import { decodeUserIdList, decodeLogData } from "@/lib/protocol";
import { runAsync, allAsync, getAsync } from "@/lib/db";
import { TERMINAL_STAGES, OperationKind } from "./kinds";
import { getOperationRow, setStage, finishOperation, queueCommandForOperation, OperationRow } from "./queue";
import { insertAttendanceLogs, upsertUserFromInfo, UserInfoResult } from "./persist";

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
  phase: "probe" | "create";
  userName: string;
  privilege: string;
}

interface DeleteUserPlan {
  phase: "apply" | "verify";
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
  // Every other kind, and the apply phase of these, treats a failed command
  // as fatal.
  const SELF_HANDLED: OperationKind[] = [
    "SYNC_USERS",
    "CREATE_USER",
    "RENAME_USER",
    "CHANGE_PRIVILEGE",
    "DELETE_USER",
  ];
  if (!input.ok && !SELF_HANDLED.includes(op.kind)) {
    await finishOperation(
      op.id,
      "error",
      `El dispositivo devolvió ${input.returnCode} al ejecutar ${input.cmdCode}.`
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
    await finishOperation(op.id, "done", "El dispositivo confirmó el cambio de nombre.");
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
    await finishOperation(op.id, "done", "Estado del dispositivo actualizado.");
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
  await finishOperation(op.id, "done", "Reloj del dispositivo sincronizado con el servidor.");
}

async function advanceSyncUsers(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: SyncUsersPlan = op.plan_json
    ? JSON.parse(op.plan_json)
    : { phase: "list", pending: [], synced: [], failed: [] };

  if (plan.phase === "list") {
    // The list itself failing means the whole operation has nothing to work
    // with — this is fatal, unlike an individual GET_USER_INFO below.
    if (!input.ok) {
      await finishOperation(op.id, "error", `El dispositivo devolvió ${input.returnCode} al listar usuarios.`);
      return;
    }
    const ids = input.ok ? decodeIdListOrEmpty(input.resultJson, input.binaries) : null;
    if (ids === null) {
      await finishOperation(op.id, "error", "No se pudo leer la lista de usuarios del dispositivo.");
      return;
    }
    if (ids.length === 0) {
      await finishOperation(op.id, "done", "El dispositivo no tiene usuarios registrados.");
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
  const entries = input.resultJson ? decodeLogData(input.resultJson, input.binaries) : null;
  if (entries === null) {
    await finishOperation(op.id, "error", "No se pudo leer el historial del dispositivo.");
    return;
  }
  const summary = await insertAttendanceLogs(op.dev_id, entries);
  const note =
    summary.total === 0
      ? "El dispositivo no reportó marcaciones."
      : `${summary.total} registros leídos del dispositivo: ${summary.inserted} nuevos, ${summary.skipped} ya estaban registrados.`;
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
        `El dispositivo devolvió ${input.returnCode} al ejecutar ${input.cmdCode}.`
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
      "No se pudo verificar el cambio; el estado real del dispositivo es desconocido."
    );
    return;
  }
  const actual = field === "user_name" ? input.resultJson.user_name : input.resultJson.user_privilege;
  const expected = field === "user_name" ? plan.expected.slice(0, 8) : plan.expected;

  if (actual === expected) {
    const verb = field === "user_name" ? "nombre cambiado a" : "privilegio cambiado a";
    await finishOperation(op.id, "done", `${verb} "${expected}" (verificado en el dispositivo).`);
  } else {
    const noun = field === "user_name" ? "nombre" : "privilegio";
    await finishOperation(
      op.id,
      "mismatch",
      `El dispositivo respondió OK pero el ${noun} sigue siendo "${actual}" (se solicitó "${expected}"). ` +
        (field === "user_privilege"
          ? "Este firmware solo aplica MANAGER de forma fiable."
          : "")
    );
  }
}

/**
 * DELETE_USER's own cmd_return_code cannot be trusted in either direction —
 * verified against real hardware: four separate deletions reported
 * cmd_return_code "Error" while a follow-up GET_USER_ID_LIST confirmed the
 * user was actually gone. So this never trusts the apply step's outcome; it
 * always re-queries the user afterward and bases done/mismatch purely on
 * whether the device still knows about them.
 */
async function advanceDeleteUser(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: DeleteUserPlan = op.plan_json ? JSON.parse(op.plan_json) : { phase: "apply" };

  if (plan.phase === "apply") {
    await setStage(op.id, "verifying", { plan: { phase: "verify" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: op.user_id });
    return;
  }

  // phase === "verify": GET_USER_INFO failing, or succeeding with no
  // user_name, means the id is free — the deletion actually worked,
  // regardless of what the apply step's return code claimed.
  const stillExists = input.ok && !!input.resultJson?.user_name;
  if (stillExists) {
    await finishOperation(
      op.id,
      "mismatch",
      `El usuario ${op.user_id} sigue existiendo en el equipo; el borrado no se aplicó.`
    );
    return;
  }

  await runAsync(`DELETE FROM users WHERE dev_id = ? AND user_id = ?`, [op.dev_id, op.user_id]);
  await runAsync(`DELETE FROM enroll_data WHERE dev_id = ? AND user_id = ?`, [op.dev_id, op.user_id]);
  await finishOperation(op.id, "done", `Usuario ${op.user_id} eliminado del equipo (verificado).`);
}

/** `user_id_count: 0` means an empty roster — decodeUserIdList itself would
 * see a zero-length binary and return null (indistinguishable from a real
 * decode failure), so that case is special-cased here before delegating. */
function decodeIdListOrEmpty(resultJson: Record<string, any> | null, binaries: Buffer[]): string[] | null {
  if (resultJson?.user_id_count === 0) return [];
  return decodeUserIdList(resultJson, binaries);
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
    // cost. A command error, or OK with no user_name, means the id is free.
    const existingName = input.ok ? input.resultJson?.user_name : null;
    if (existingName) {
      await finishOperation(
        op.id,
        "error",
        `Ya existe el usuario ${op.user_id} ("${existingName}") en el dispositivo. ` +
          `Usa Renombrar o Cambiar privilegio; crear encima destruiría sus huellas.`
      );
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

  // phase === "verify"
  if (!input.ok || !input.resultJson?.user_name) {
    await finishOperation(
      op.id,
      "mismatch",
      "No se pudo verificar la creación; el estado real del dispositivo es desconocido."
    );
    return;
  }
  // Persist exactly what the device confirmed, not just what was requested
  // — handleCommandResult already does this for ad-hoc GET_USER_INFO calls,
  // but that path doesn't run for commands that belong to an operation.
  await upsertUserFromInfo(op.dev_id, input.resultJson as UserInfoResult, input.binaries);
  await finishOperation(
    op.id,
    "done",
    `Usuario ${op.user_id} creado y verificado. Registra su huella físicamente en el equipo.`
  );
}

const TEN_MINUTES_MS = 10 * 60 * 1000;
const THREE_MINUTES_MS = 3 * 60 * 1000;

/**
 * Every "verifying"-stage command is a GET_USER_INFO re-querying a specific
 * id (RENAME_USER/CHANGE_PRIVILEGE/CREATE_USER's verify) — and verified
 * against real hardware, this command's response time is itself a signal
 * on this firmware: an id that exists has answered in seconds in every
 * observation, an id that doesn't exist has never answered at all, not
 * even slowly. That second case is DELETE_USER's own success path (a
 * deletion that actually worked leaves nothing to find), so making every
 * successful deletion sit out the full 3-minute stale-sweep before it can
 * be reported as done — which real usage showed happening — is both a bad
 * wait and a wrong-looking "error" for something that actually succeeded.
 * A short timeout here doubles as that signal instead.
 */
const VERIFY_TIMEOUT_MS = 25 * 1000;

/**
 * Lazy expiry: no cron in this stack, so this runs on the device's own poll
 * heartbeat (handleReceiveCmd, ~every 10s) and from the operations list
 * queries, which covers a device that never comes back to poll at all.
 * Expires BOTH the stuck command (so a stale WAIT can't resurrect a closed
 * operation hours later) and the operation itself.
 */
export async function sweepStaleOperations(): Promise<number> {
  const now = Date.now();
  const candidates = await allAsync<OperationRow>(
    `SELECT * FROM operations WHERE stage IN ('queued','sent','waiting','verifying')`
  );

  let expired = 0;
  for (const op of candidates) {
    const age = now - op.updated_at;
    const isVerifying = op.stage === "verifying";
    const threshold = isVerifying ? VERIFY_TIMEOUT_MS : op.stage === "sent" ? THREE_MINUTES_MS : TEN_MINUTES_MS;
    if (age < threshold) continue;

    const transId = op.current_trans_id;
    if (transId) {
      await runAsync(
        `UPDATE commands SET status = 'ERROR', cmd_return_code = 'TIMEOUT',
                updated_at = unixepoch('now') * 1000
          WHERE trans_id = ? AND status IN ('WAIT','RUN')`,
        [transId]
      );
    }

    if (isVerifying && transId) {
      // Route through the normal per-kind handler as if the device had
      // reported failure, instead of a generic timeout error.
      // RENAME_USER/CHANGE_PRIVILEGE/CREATE_USER turn that into "mismatch"
      // (already the right call — cannot confirm, don't claim success).
      // DELETE_USER turns it into "done" — a non-answer here means the id
      // is gone, exactly what a successful deletion looks like.
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

    await finishOperation(op.id, "error", "El dispositivo no respondió a tiempo; la operación se canceló.");
    expired++;
  }
  return expired;
}
