// The orchestration engine: reacts to a completed command by deciding what
// the parent operation does next — queue another step, verify, or finish.
// Invoked from lib/handlers/protocol-handlers.ts right after a command's
// result is stored, wrapped in a try/catch there so a bug here can never
// cost the device its HTTP 200 (the firmware does not retry send_cmd_result;
// losing that response loses the result forever).

import { decodeUserIdList, decodeLogData, resolveBinaryRef } from "@/lib/protocol";
import { runAsync, allAsync, getAsync, prisma, NOW_MS } from "@/lib/db";
import { TERMINAL_STAGES, OperationKind, MAX_ID_ASSIGNMENT_ATTEMPTS, MAX_FINGERPRINT_INDEX } from "./kinds";
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
  phase: "probe" | "create" | "verify" | "apply_privilege" | "verify_privilege";
  userName: string;
  privilege: string;
}

interface DeleteUserPlan {
  phase: "apply" | "verify";
}

interface CaptureFingerprintParams {
  employeeId: number;
}

interface PushFingerprintPlan {
  phase: "apply" | "verify";
}

interface PushFingerprintParams {
  employeeId: number;
  fingerIndex: number;
}

interface AddEmployeeToDevicePlan {
  phase: "probe" | "create" | "verify_create" | "push" | "verify_push" | "apply_privilege" | "verify_privilege";
  candidateId: number;
  attempt: number;
  userName: string;
  privilege: string;
  pendingFingers: number[];
  pushedFingers: number[];
  failedFingers: Array<{ fingerIndex: number; reason: string }>;
  currentFinger?: number;
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

    case "CAPTURE_FINGERPRINT":
      await advanceCaptureFingerprint(op, input);
      break;

    case "PUSH_FINGERPRINT":
      await advancePushFingerprint(op, input);
      break;

    case "ADD_EMPLOYEE_TO_DEVICE":
      await advanceAddEmployeeToDevice(op, input);
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
          ? "Verificado contra hardware real: un privilegio elevado no se aplica mientras el usuario no " +
            "tenga ninguna huella registrada — registrale la huella físicamente y reintentá."
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

/**
 * Lee la forma limpia de 612 bytes (GET_USER_INFO) y guarda como copia
 * canónica por empleado TODO lo que el equipo tiene registrado para este
 * usuario — nunca pide elegir un número de slot: verificado contra hardware
 * real (2026-09-08) que ese número (backup_number) es solo orden de
 * registro, no identidad de dedo (un índice derecho registrado quedó en el
 * mismo slot 0 que antes se documentaba como "pulgar derecho"). Nunca usar
 * GET_ENROLL_DATA para esto — verificado contra hardware real que esa forma
 * (524 bytes) trae memoria sin inicializar del equipo a partir del byte 60
 * (ver docs/05-commands-catalog.md, "Migración de huellas entre
 * dispositivos").
 */
async function advanceCaptureFingerprint(op: OperationRow, input: AdvanceInput): Promise<void> {
  const params: CaptureFingerprintParams = op.params_json
    ? JSON.parse(op.params_json)
    : { employeeId: 0 };

  const entries = (input.resultJson?.enroll_data_array as
    | Array<{ backup_number: number; enroll_data?: unknown }>
    | undefined
  )?.filter((e) => e.backup_number >= 0 && e.backup_number <= MAX_FINGERPRINT_INDEX);

  if (!entries || entries.length === 0) {
    await finishOperation(
      op.id,
      "error",
      `El usuario ${op.user_id} no tiene huellas registradas en este equipo.`
    );
    return;
  }

  const captured: number[] = [];
  const failed: Array<{ slot: number; reason: string }> = [];
  for (const entry of entries) {
    const template = resolveBinaryRef(entry.enroll_data, input.binaries);
    if (!template || template.length < 100) {
      failed.push({ slot: entry.backup_number, reason: "sin datos binarios (o llegaron vacíos)" });
      continue;
    }
    // Prisma's generated Bytes type wants Uint8Array<ArrayBuffer>
    // specifically; Buffer's backing store is typed as the wider
    // ArrayBufferLike, so a plain Buffer doesn't satisfy it structurally
    // even though it works at runtime.
    const templateBytes = new Uint8Array(template);
    await prisma.employee_fingerprint.upsert({
      where: { employee_id_finger_index: { employee_id: params.employeeId, finger_index: entry.backup_number } },
      create: {
        employee_id: params.employeeId,
        finger_index: entry.backup_number,
        template: templateBytes,
        source_dev_id: op.dev_id,
      },
      update: { template: templateBytes, source_dev_id: op.dev_id },
    });
    captured.push(entry.backup_number);
  }

  if (captured.length === 0) {
    await finishOperation(op.id, "error", "Ninguna huella se pudo leer correctamente — reintentá.");
    return;
  }

  // Al menos una se leyó bien — igual que ADD_EMPLOYEE_TO_DEVICE, un fallo
  // parcial no convierte el éxito parcial en error.
  const note =
    captured.length === 1
      ? `1 huella capturada (slot ${captured[0]}) desde este equipo.`
      : `${captured.length} huellas capturadas (slots ${captured.join(", ")}) desde este equipo.`;
  await finishOperation(op.id, "done", failed.length > 0 ? `${note} ${failed.length} fallaron.` : note);
}

/**
 * Escribe la copia canónica de una huella en otro equipo, vía SET_ENROLL_DATA
 * — verificado contra hardware real que este comando agrega una huella a un
 * usuario que ya existe sin tocar el resto de su ficha (nombre, privilegio,
 * otras huellas). El usuario destino tiene que existir de antemano en el
 * equipo (lo garantiza requerir un employee_device_enrollment activo antes de
 * encolar — ver startPushFingerprint).
 *
 * Igual que DELETE_USER, no se confía en el cmd_return_code de la escritura
 * en ninguna dirección: siempre se verifica con un GET_USER_INFO posterior.
 * Esa verificación solo confirma que el equipo AHORA reporta una huella en
 * ese dedo — no que el dedo físico vaya a matchear (eso solo se confirma
 * cuando la persona marca asistencia con ese dedo en el equipo destino).
 */
async function advancePushFingerprint(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: PushFingerprintPlan = op.plan_json ? JSON.parse(op.plan_json) : { phase: "apply" };
  const params: PushFingerprintParams = op.params_json
    ? JSON.parse(op.params_json)
    : { employeeId: 0, fingerIndex: -1 };

  if (plan.phase === "apply") {
    await setStage(op.id, "verifying", { plan: { phase: "verify" } });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: op.user_id });
    return;
  }

  // phase === "verify"
  const entries = input.resultJson?.enroll_data_array as
    | Array<{ backup_number: number; enroll_data?: unknown }>
    | undefined;
  const entry = input.ok ? entries?.find((e) => e.backup_number === params.fingerIndex) : undefined;
  const template = entry ? resolveBinaryRef(entry.enroll_data, input.binaries) : null;

  if (!template) {
    await finishOperation(
      op.id,
      "mismatch",
      `El equipo destino no reporta una huella en el dedo ${params.fingerIndex} para el usuario ${op.user_id}. ` +
        "El firmware puede reportar OK sin haber aplicado el cambio — reintentá."
    );
    return;
  }

  await finishOperation(
    op.id,
    "done",
    `Huella del dedo ${params.fingerIndex} escrita y verificada en este equipo (usuario ${op.user_id}, ` +
      `${template.length} bytes). Confirmalo pidiéndole a la persona que marque asistencia con ese dedo.`
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
        attempt: 1,
        userName: "",
        privilege: "USER",
        pendingFingers: [],
        pushedFingers: [],
        failedFingers: [],
      };
  const params: AddEmployeeToDeviceParams = op.params_json
    ? JSON.parse(op.params_json)
    : { employeeId: 0 };

  if (plan.phase === "probe") {
    const existingName = input.ok ? input.resultJson?.user_name : null;
    if (existingName) {
      if (plan.attempt >= MAX_ID_ASSIGNMENT_ATTEMPTS) {
        await finishOperation(
          op.id,
          "error",
          `No se pudo asignar un ID automáticamente tras ${plan.attempt} intentos (el último, ${plan.candidateId}, ` +
            `ya está en uso por "${existingName}"). Reintentá la operación — el próximo intento partirá de un ID más alto.`
        );
        return;
      }
      const nextCandidate = plan.candidateId + 1;
      const nextPlan: AddEmployeeToDevicePlan = {
        ...plan,
        candidateId: nextCandidate,
        attempt: plan.attempt + 1,
      };
      await setStage(op.id, "waiting", { plan: nextPlan });
      await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: String(nextCandidate) });
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
    // verificado en CREATE_USER) — la única confirmación real es releer.
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_create" };
    await setStage(op.id, "verifying", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: String(plan.candidateId) });
    return;
  }

  if (plan.phase === "verify_create") {
    if (!input.ok || !input.resultJson?.user_name) {
      await finishOperation(
        op.id,
        "mismatch",
        "No se pudo verificar la creación del usuario; el estado real del dispositivo es desconocido."
      );
      return;
    }
    await upsertUserFromInfo(op.dev_id, input.resultJson as UserInfoResult, input.binaries);
    await prisma.employee_device_enrollment.create({
      data: {
        employee_id: params.employeeId,
        dev_id: op.dev_id,
        device_user_id: String(plan.candidateId),
      },
    });
    await advanceAddEmployeeToDevicePushNext(op, { ...plan, phase: "push" }, params);
    return;
  }

  if (plan.phase === "push") {
    // Igual que PUSH_FINGERPRINT: el cmd_return_code de SET_ENROLL_DATA no
    // es confiable en ninguna dirección — siempre se verifica con una
    // relectura antes de dar por copiada la huella.
    const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "verify_push" };
    await setStage(op.id, "verifying", { plan: nextPlan });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: String(plan.candidateId) });
    return;
  }

  if (plan.phase === "verify_push") {
    const finger = plan.currentFinger ?? -1;
    const entries = input.resultJson?.enroll_data_array as Array<{ backup_number: number }> | undefined;
    const wasWritten = input.ok && !!entries?.some((e) => e.backup_number === finger);

    const pushedFingers = wasWritten ? [...plan.pushedFingers, finger] : plan.pushedFingers;
    const failedFingers = wasWritten
      ? plan.failedFingers
      : [
          ...plan.failedFingers,
          { fingerIndex: finger, reason: input.ok ? "no reportada tras la escritura" : input.returnCode },
        ];

    await advanceAddEmployeeToDevicePushNext(
      op,
      { ...plan, phase: "push", pushedFingers, failedFingers },
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
      `${fingerprintNote} Privilegio "${plan.privilege}" verificado en el dispositivo.`
    );
    return;
  }

  // Verificado contra hardware real (2026-09-08): un privilegio elevado no
  // se aplica mientras el usuario no tenga ninguna huella registrada — el
  // equipo responde OK pero lo deja en USER. Si esta operación no logró
  // copiar ninguna huella, esa es casi con certeza la causa.
  const reason =
    plan.pushedFingers.length === 0
      ? "no se pudo aplicar todavía — este firmware solo acepta privilegios elevados una vez que el " +
        'usuario tiene al menos una huella registrada. Volvé a intentar "Cambiar privilegio" después de ' +
        "registrarle la huella."
      : `el dispositivo respondió OK pero el privilegio sigue siendo "${actualPrivilege ?? "desconocido"}".`;
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

/** Toma el siguiente dedo pendiente y lo escribe, o pasa a aplicar el
 * privilegio (o cierra la operación) si ya no quedan. */
async function advanceAddEmployeeToDevicePushNext(
  op: OperationRow,
  plan: AddEmployeeToDevicePlan,
  params: AddEmployeeToDeviceParams
): Promise<void> {
  if (plan.pendingFingers.length === 0) {
    const fingerprintMismatch = plan.pushedFingers.length === 0 && plan.failedFingers.length > 0;
    await advanceAddEmployeeToDeviceFinishOrElevate(op, {
      ...plan,
      fingerprintNote: summarizeAddEmployeeToDevice(plan),
      fingerprintMismatch,
    });
    return;
  }

  const [finger, ...rest] = plan.pendingFingers;
  const fingerprint = await prisma.employee_fingerprint.findUnique({
    where: { employee_id_finger_index: { employee_id: params.employeeId, finger_index: finger } },
  });
  if (!fingerprint || fingerprint.template.length < 612) {
    await advanceAddEmployeeToDevicePushNext(
      op,
      {
        ...plan,
        pendingFingers: rest,
        failedFingers: [...plan.failedFingers, { fingerIndex: finger, reason: "plantilla local inválida o ausente" }],
      },
      params
    );
    return;
  }

  // Único campo que hace falta tocar: el user_id embebido (offset 608) — ver
  // startPushFingerprint / docs/05-commands-catalog.md para la receta completa.
  const patched = Buffer.from(fingerprint.template);
  patched.writeUInt32LE(plan.candidateId, 608);

  const nextPlan: AddEmployeeToDevicePlan = { ...plan, phase: "push", pendingFingers: rest, currentFinger: finger };
  await setStage(op.id, "waiting", { plan: nextPlan });
  await queueCommandForOperation(
    op.id,
    op.dev_id,
    "SET_ENROLL_DATA",
    { user_id: String(plan.candidateId), backup_number: finger, enroll_data: "BIN_1" },
    patched
  );
}

function summarizeAddEmployeeToDevice(plan: AddEmployeeToDevicePlan): string {
  const total = plan.pushedFingers.length + plan.failedFingers.length;
  if (total === 0) {
    return `Usuario ${plan.candidateId} creado y vinculado (verificado). Sin huellas capturadas todavía para copiar.`;
  }
  const base =
    `Usuario ${plan.candidateId} creado y vinculado (verificado). ` +
    `${plan.pushedFingers.length} de ${total} huella(s) copiada(s) y verificada(s).`;
  return plan.failedFingers.length > 0
    ? `${base} Fallaron: dedo(s) ${plan.failedFingers.map((f) => f.fingerIndex).join(", ")}.`
    : base;
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

  if (plan.phase === "verify") {
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
      `Usuario ${op.user_id} creado con privilegio "${plan.privilege}" (verificado en el dispositivo).`
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
// own short window instead (see PROBE_TIMEOUT_MS).
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
  const candidates = await allAsync<OperationRow>(
    `SELECT * FROM operations WHERE stage IN ('queued','sent','waiting','verifying')`
  );

  let expired = 0;
  for (const op of candidates) {
    const age = now - op.updated_at;
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
      // RENAME_USER/CHANGE_PRIVILEGE's verify turns that into "mismatch"
      // (already the right call — cannot confirm, don't claim success).
      // DELETE_USER's verify turns it into "done" — a non-answer here means
      // the id is gone, exactly what a successful deletion looks like.
      // CREATE_USER/ADD_EMPLOYEE_TO_DEVICE's probe turns it into "the
      // candidate id is free" — exactly the same hang, at the opposite end
      // of a user's lifecycle.
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
