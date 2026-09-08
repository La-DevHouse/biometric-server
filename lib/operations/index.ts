// Public API for the dashboard. One function per high-level action, plus the
// queries the UI needs to render the live operations tracker. Framework-free
// (no Next imports) so it stays unit-testable; the 'use server' boundary
// lives in app/admin/**/actions.ts, which just calls through to these.

import { initDb, allAsync, getAsync, runAsync, prisma, NOW_MS } from "@/lib/db";
import {
  OperationKind,
  OperationStage,
  Privilege,
  PRIVILEGE_SCREEN_LABEL,
  TERMINAL_STAGES,
  MAX_FINGERPRINT_INDEX,
  truncateUserName,
  OPERATION_LABELS,
  STAGE_LABELS,
} from "./kinds";
import {
  createOperation,
  queueCommandForOperation,
  getOperationRow,
  finishOperation,
  OperationRow,
} from "./queue";
import { sweepStaleOperations } from "./advance";
import { isDeviceOnline } from "@/lib/deviceStatus";

export type { OperationKind, OperationStage, Privilege };
export { PRIVILEGE_SCREEN_LABEL };

export interface StartResult {
  id: number;
  /** Advisory only — the operation is already queued either way. */
  warning?: string;
}

export interface OperationView {
  id: number;
  kind: OperationKind;
  label: string;
  dev_id: string;
  user_id: string | null;
  stage: OperationStage;
  step_index: number;
  step_total: number;
  result_note: string | null;
  error_note: string | null;
  isTerminal: boolean;
  stageLabel: string;
  /** "Paso 3 de 12", or "" for single-step operations. */
  progressLabel: string;
  deviceOnline: boolean;
  ageMs: number;
  note: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
}

const OFFLINE_WARNING = "El dispositivo está desconectado. La operación quedará en cola.";


interface DeviceRow {
  dev_id: string;
  last_seen_at: number | null;
}

async function ensureDevice(devId: string): Promise<DeviceRow> {
  await initDb();
  const dev = await getAsync<DeviceRow>(
    `SELECT dev_id, last_seen_at FROM devices WHERE dev_id = ?`,
    [devId]
  );
  if (!dev) throw new Error(`Dispositivo desconocido: ${devId}`);
  return dev;
}

function offlineWarning(dev: DeviceRow): string | undefined {
  return isDeviceOnline(dev.last_seen_at) ? undefined : OFFLINE_WARNING;
}

function combineWarnings(...warnings: Array<string | undefined>): string | undefined {
  const present = warnings.filter((w): w is string => !!w);
  return present.length ? present.join(" ") : undefined;
}

/**
 * Guards against double-click storms: if a non-terminal operation of the
 * same (kind, dev_id, user_id) already exists, returns it instead of
 * queuing a duplicate 10-40s round trip.
 */
async function findActiveOperation(
  kind: OperationKind,
  devId: string,
  userId?: string | null
): Promise<number | null> {
  const row = await getAsync<{ id: number }>(
    `SELECT id FROM operations
      WHERE kind = ? AND dev_id = ? AND user_id IS NOT DISTINCT FROM ?
        AND stage NOT IN ('done','mismatch','error','canceled')
      ORDER BY id DESC LIMIT 1`,
    [kind, devId, userId ?? null]
  );
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// start* — one per high-level operation
// ---------------------------------------------------------------------------

export async function startSyncClock(devId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("SYNC_CLOCK", devId);
  if (existing) return { id: existing };

  const id = await createOperation({ kind: "SYNC_CLOCK", label: OPERATION_LABELS.SYNC_CLOCK, devId });
  // No `time` param — handleReceiveCmd stamps toDeviceTime() at delivery so
  // the clock lands accurate instead of seconds behind. Must stay this way.
  await queueCommandForOperation(id, devId, "SET_TIME", {});
  return { id, warning: offlineWarning(dev) };
}

export async function startRenameDevice(devId: string, fkName: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const name = fkName.trim();
  if (!name) throw new Error("El nombre no puede estar vacío.");

  const existing = await findActiveOperation("RENAME_DEVICE", devId);
  if (existing) return { id: existing };

  const label = `${OPERATION_LABELS.RENAME_DEVICE}: "${name}"`;
  const id = await createOperation({ kind: "RENAME_DEVICE", label, devId, params: { fk_name: name } });
  await queueCommandForOperation(id, devId, "SET_FK_NAME", { fk_name: name });
  return { id, warning: offlineWarning(dev) };
}

export async function startSyncUsers(devId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("SYNC_USERS", devId);
  if (existing) return { id: existing };

  // Firmware WS535BW1_BSCS_v1.5.31 reindexes its whole user table after
  // SET_USER_INFO on a new user, reporting transient (wrong) data for
  // several minutes — verified against real hardware. A sync started right
  // after a creation could capture that transient state.
  const recentCreate = await getAsync<{ id: number }>(
    `SELECT id FROM operations
      WHERE kind = 'CREATE_USER' AND dev_id = ? AND stage = 'done' AND finished_at > ?
      ORDER BY id DESC LIMIT 1`,
    [devId, Date.now() - 5 * 60 * 1000]
  );

  const warning = combineWarnings(
    recentCreate
      ? "Se creó un usuario hace poco; el dispositivo puede reportar datos transitorios (privilegio USER, sin huellas) durante unos minutos."
      : undefined,
    // Verified against real hardware: GET_USER_ID_LIST silently excludes
    // USER-privilege / no-fingerprint-yet accounts (GET_DEVICE_STATUS
    // reported 6 total users while this command listed only the 3 with
    // fingerprints). A user created from the panel who hasn't registered a
    // fingerprint yet may not show up here even though they really exist.
    "Esta lista puede no incluir usuarios sin huella registrada todavía — es una limitación observada del equipo, no un error del panel.",
    offlineWarning(dev)
  );

  const id = await createOperation({
    kind: "SYNC_USERS",
    label: OPERATION_LABELS.SYNC_USERS,
    devId,
    plan: { phase: "list", pending: [], synced: [], failed: [] },
  });
  await queueCommandForOperation(id, devId, "GET_USER_ID_LIST", {});
  return { id, warning };
}

export async function startRenameUser(
  devId: string,
  userId: string,
  newName: string
): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("El nombre no puede estar vacío.");

  const existing = await findActiveOperation("RENAME_USER", devId, userId);
  if (existing) return { id: existing };

  // Always verified: the truncation quirk means what actually gets stored
  // can genuinely differ from what was typed, so "done" should mean
  // "confirmed on the device", not just "command accepted".
  const truncated = truncateUserName(trimmed);
  const warning = combineWarnings(
    truncated !== trimmed
      ? `El dispositivo trunca los nombres a 8 caracteres: se guardará "${truncated}".`
      : undefined,
    offlineWarning(dev)
  );

  const label = `${OPERATION_LABELS.RENAME_USER} ${userId} a "${truncated}"`;
  const id = await createOperation({
    kind: "RENAME_USER",
    label,
    devId,
    userId,
    params: { user_name: trimmed },
    plan: { phase: "apply", expected: truncated },
  });
  await queueCommandForOperation(id, devId, "SET_USER_NAME", { user_id: userId, user_name: truncated });
  return { id, warning };
}

export async function startChangePrivilege(
  devId: string,
  userId: string,
  privilege: Privilege
): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("CHANGE_PRIVILEGE", devId, userId);
  if (existing) return { id: existing };

  const warning = offlineWarning(dev);

  const label = `${OPERATION_LABELS.CHANGE_PRIVILEGE} de usuario ${userId} a ${privilege}`;
  const id = await createOperation({
    kind: "CHANGE_PRIVILEGE",
    label,
    devId,
    userId,
    params: { user_privilege: privilege },
    plan: { phase: "apply", expected: privilege },
  });
  await queueCommandForOperation(id, devId, "SET_USER_PRIVILEGE", {
    user_id: userId,
    user_privilege: privilege,
  });
  return { id, warning };
}

export interface CreateUserInput {
  userId: string;
  userName: string;
  privilege?: Privilege;
}

export async function startCreateUser(devId: string, input: CreateUserInput): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const userId = input.userId.trim();
  const userName = input.userName.trim();
  if (!userId) throw new Error("El ID de usuario no puede estar vacío.");
  if (!userName) throw new Error("El nombre no puede estar vacío.");

  // Cheap local check before any 10-40s round trip. The device-side probe
  // in advance.ts is what actually protects against the destructive
  // SET_USER_INFO reindex (the local `users` cache can be stale) — this is
  // just an instant no-op for the obvious case.
  const localExisting = await getAsync<{ user_name: string }>(
    `SELECT user_name FROM users WHERE dev_id = ? AND user_id = ?`,
    [devId, userId]
  );
  if (localExisting) {
    throw new Error(
      `Ya existe el usuario ${userId} ("${localExisting.user_name}") según los datos sincronizados. ` +
        `Usa Renombrar o Cambiar privilegio.`
    );
  }

  const existing = await findActiveOperation("CREATE_USER", devId, userId);
  if (existing) return { id: existing };

  const truncatedName = truncateUserName(userName);
  const privilege: Privilege = input.privilege ?? "USER";
  const warning = combineWarnings(
    truncatedName !== userName
      ? `El dispositivo trunca los nombres a 8 caracteres: se guardará "${truncatedName}".`
      : undefined,
    privilege !== "USER"
      ? `El privilegio "${privilege}" no quedará aplicado hasta que la persona tenga una huella registrada en este equipo — verificado que este firmware lo ignora en silencio sin eso. Se intenta aparte después de crear, pero puede terminar reportando que no se pudo aplicar todavía.`
      : undefined,
    offlineWarning(dev)
  );

  const label = `${OPERATION_LABELS.CREATE_USER} ${userId} ("${truncatedName}")`;
  const id = await createOperation({
    kind: "CREATE_USER",
    label,
    devId,
    userId,
    params: { user_name: truncatedName, user_privilege: privilege },
    plan: { phase: "probe", userName: truncatedName, privilege },
  });
  // Probe with GET_USER_INFO for this exact id — see advance.ts for why
  // GET_USER_ID_LIST was tried and reverted: it doesn't enumerate every
  // user (verified against real hardware, it silently excludes
  // USER-privilege / no-fingerprint-yet accounts), so it can't be trusted
  // to say an id is free.
  await queueCommandForOperation(id, devId, "GET_USER_INFO", { user_id: userId });
  return { id, warning };
}

export async function startDeleteUser(devId: string, userId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("DELETE_USER", devId, userId);
  if (existing) return { id: existing };

  const label = `${OPERATION_LABELS.DELETE_USER} ${userId}`;
  const id = await createOperation({ kind: "DELETE_USER", label, devId, userId });
  await queueCommandForOperation(id, devId, "DELETE_USER", { user_id: userId });
  return { id, warning: offlineWarning(dev) };
}

export async function startSyncLogs(devId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("SYNC_LOGS", devId);
  if (existing) return { id: existing };

  const id = await createOperation({ kind: "SYNC_LOGS", label: OPERATION_LABELS.SYNC_LOGS, devId });
  await queueCommandForOperation(id, devId, "GET_LOG_DATA", {});
  return { id, warning: offlineWarning(dev) };
}

export async function startClearLogs(devId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("CLEAR_LOGS", devId);
  if (existing) return { id: existing };

  const id = await createOperation({ kind: "CLEAR_LOGS", label: OPERATION_LABELS.CLEAR_LOGS, devId });
  await queueCommandForOperation(id, devId, "CLEAR_LOG_DATA", {});
  return { id, warning: offlineWarning(dev) };
}

export async function startClearEnrollData(devId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("CLEAR_ENROLL", devId);
  if (existing) return { id: existing };

  const id = await createOperation({ kind: "CLEAR_ENROLL", label: OPERATION_LABELS.CLEAR_ENROLL, devId });
  await queueCommandForOperation(id, devId, "CLEAR_ENROLL_DATA", {});
  return { id, warning: offlineWarning(dev) };
}

export async function startViewBiometrics(devId: string, userId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("VIEW_BIOMETRICS", devId, userId);
  if (existing) return { id: existing };

  const label = `${OPERATION_LABELS.VIEW_BIOMETRICS} de usuario ${userId}`;
  const id = await createOperation({ kind: "VIEW_BIOMETRICS", label, devId, userId });
  await queueCommandForOperation(id, devId, "GET_USER_INFO", { user_id: userId });
  return { id, warning: offlineWarning(dev) };
}

export async function startRefreshStatus(devId: string): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const existing = await findActiveOperation("REFRESH_STATUS", devId);
  if (existing) return { id: existing };

  const id = await createOperation({ kind: "REFRESH_STATUS", label: OPERATION_LABELS.REFRESH_STATUS, devId });
  await queueCommandForOperation(id, devId, "GET_DEVICE_STATUS", {});
  return { id, warning: offlineWarning(dev) };
}

// ---------------------------------------------------------------------------
// Migración de huellas entre dispositivos — ver docs/05-commands-catalog.md
// ("Migración de huellas entre dispositivos") para la receta verificada
// contra hardware real. CAPTURE_FINGERPRINT lee la forma limpia de 612 bytes
// (GET_USER_INFO, nunca GET_ENROLL_DATA) hacia la copia canónica por
// empleado (`employee_fingerprint`); PUSH_FINGERPRINT la escribe en otro
// equipo donde la persona ya tiene un enrolamiento activo, parchando el
// user_id embebido (offset 608).
// ---------------------------------------------------------------------------

// El número de slot (backup_number) es un índice de orden de registro del
// equipo, no una identidad de dedo — verificado contra hardware real
// (2026-09-08): un dedo índice registrado físicamente quedó en el slot 0, el
// mismo slot que la documentación asociaba a "pulgar derecho". Por eso esto
// nunca pide elegir un número: lee todo lo que el equipo tiene registrado
// para el usuario y lo captura tal cual, uno por slot.
export async function startCaptureFingerprint(
  employeeId: number,
  devId: string,
  deviceUserId: string
): Promise<StartResult> {
  const dev = await ensureDevice(devId);

  const existing = await findActiveOperation("CAPTURE_FINGERPRINT", devId, deviceUserId);
  if (existing) return { id: existing };

  const label = `${OPERATION_LABELS.CAPTURE_FINGERPRINT} de usuario ${deviceUserId}`;
  const id = await createOperation({
    kind: "CAPTURE_FINGERPRINT",
    label,
    devId,
    userId: deviceUserId,
    params: { employeeId },
  });
  await queueCommandForOperation(id, devId, "GET_USER_INFO", { user_id: deviceUserId });
  return { id, warning: offlineWarning(dev) };
}

export async function startPushFingerprint(
  employeeId: number,
  fingerIndex: number,
  targetDevId: string
): Promise<StartResult> {
  const dev = await ensureDevice(targetDevId);

  const fingerprint = await prisma.employee_fingerprint.findUnique({
    where: { employee_id_finger_index: { employee_id: employeeId, finger_index: fingerIndex } },
  });
  if (!fingerprint) {
    throw new Error(
      "No hay una huella capturada para ese dedo. Capturala primero desde el equipo de origen."
    );
  }
  if (fingerprint.template.length < 612) {
    throw new Error(
      `La huella capturada mide ${fingerprint.template.length} bytes — se esperaban al menos 612. Puede estar corrupta; volvé a capturarla.`
    );
  }

  const enrollment = await prisma.employee_device_enrollment.findFirst({
    where: { employee_id: employeeId, dev_id: targetDevId, status: "active" },
  });
  if (!enrollment) {
    throw new Error(
      "La persona no tiene un usuario vinculado en el equipo destino. Vinculala primero desde Enrolamiento."
    );
  }

  const targetUserId = Number(enrollment.device_user_id);
  if (!Number.isInteger(targetUserId)) {
    throw new Error(
      `El ID de usuario del equipo destino ("${enrollment.device_user_id}") no es numérico — este ` +
        `firmware codifica el ID como entero de 4 bytes dentro de la huella, así que no se puede migrar.`
    );
  }

  const existing = await findActiveOperation("PUSH_FINGERPRINT", targetDevId, enrollment.device_user_id);
  if (existing) return { id: existing };

  // Único campo que hace falta tocar: el user_id embebido. El resto (índice
  // de slot, campos internos del firmware) el equipo destino los regenera
  // solo — verificado contra hardware real.
  const patched = Buffer.from(fingerprint.template);
  patched.writeUInt32LE(targetUserId, 608);

  const label = `${OPERATION_LABELS.PUSH_FINGERPRINT} (dedo ${fingerIndex}) a usuario ${enrollment.device_user_id}`;
  const id = await createOperation({
    kind: "PUSH_FINGERPRINT",
    label,
    devId: targetDevId,
    userId: enrollment.device_user_id,
    params: { employeeId, fingerIndex },
    plan: { phase: "apply" },
  });
  await queueCommandForOperation(
    id,
    targetDevId,
    "SET_ENROLL_DATA",
    { user_id: enrollment.device_user_id, backup_number: fingerIndex, enroll_data: "BIN_1" },
    patched
  );
  return {
    id,
    warning: combineWarnings(
      offlineWarning(dev),
      "La confirmación real es física: que la persona marque asistencia con ese dedo en el equipo destino."
    ),
  };
}

// ---------------------------------------------------------------------------
// Alta de empleado en un equipo nuevo — ver docs/02-architecture.md
// ("Agregar empleado al equipo"). Nunca automático: cada equipo se elige a
// mano (o en lote, varios a la vez), nunca se propaga solo al vincular a una
// empresa. El ID de usuario se asigna solo, con reintento ante colisión (ver
// advanceAddEmployeeToDevice); si la persona ya tiene huellas capturadas
// (employee_fingerprint) se copian de una vez, sin pasos manuales extra.
// ---------------------------------------------------------------------------

export interface AddEmployeeToDeviceInput {
  employeeId: number;
  userName: string;
  privilege?: Privilege;
}

export async function startAddEmployeeToDevice(
  devId: string,
  input: AddEmployeeToDeviceInput
): Promise<StartResult> {
  const dev = await ensureDevice(devId);
  const userName = input.userName.trim();
  if (!userName) throw new Error("El nombre no puede estar vacío.");

  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw new Error("Empleado no encontrado.");

  const alreadyLinked = await prisma.employee_device_enrollment.findFirst({
    where: { employee_id: input.employeeId, dev_id: devId, status: "active" },
  });
  if (alreadyLinked) {
    throw new Error(`Esta persona ya está vinculada a este equipo (usuario ${alreadyLinked.device_user_id}).`);
  }

  // Clave de idempotencia propia: a esta altura todavía no hay un
  // device_user_id real (se decide recién en el primer paso), así que no se
  // puede usar como `userId` de findActiveOperation igual que el resto de
  // las operaciones.
  const opUserKey = `emp:${input.employeeId}`;
  const existing = await findActiveOperation("ADD_EMPLOYEE_TO_DEVICE", devId, opUserKey);
  if (existing) return { id: existing };

  // Candidato inicial: MAX(user_id)+1 entre los usuarios numéricos ya
  // sincronizados localmente de este equipo. Es solo un punto de partida
  // barato — el paso "probe" (GET_USER_INFO contra el equipo real, con
  // reintento) es lo único que de verdad protege contra colisión, igual que
  // ya hace CREATE_USER.
  const maxRow = await getAsync<{ max_id: number | null }>(
    `SELECT MAX(user_id::int) AS max_id FROM users WHERE dev_id = ? AND user_id ~ '^[0-9]+$'`,
    [devId]
  );
  const candidateId = (maxRow?.max_id ?? 0) + 1;

  const truncatedName = truncateUserName(userName);
  const privilege: Privilege = input.privilege ?? "USER";

  const fingerprints = await prisma.employee_fingerprint.findMany({
    where: { employee_id: input.employeeId, finger_index: { lte: MAX_FINGERPRINT_INDEX } },
    select: { finger_index: true },
    orderBy: { finger_index: "asc" },
  });
  const pendingFingers = fingerprints.map((f) => f.finger_index);

  const warning = combineWarnings(
    truncatedName !== userName
      ? `El dispositivo trunca los nombres a 8 caracteres: se guardará "${truncatedName}".`
      : undefined,
    pendingFingers.length > 0
      ? `Esta persona ya tiene ${pendingFingers.length} huella(s) capturada(s) — se copiarán a este equipo automáticamente tras crear el usuario.`
      : "Esta persona no tiene huellas capturadas todavía — se creará el usuario, pero hay que registrarle la huella físicamente en algún equipo (o copiarla desde uno donde ya la tenga) para que pueda marcar aquí.",
    privilege !== "USER" && pendingFingers.length === 0
      ? `El privilegio "${privilege}" no quedará aplicado hasta que la persona tenga una huella registrada en este equipo — verificado que este firmware lo ignora en silencio sin eso. Se reintenta solo al final, pero puede terminar reportando que no se pudo aplicar todavía.`
      : undefined,
    offlineWarning(dev)
  );

  const label = `${OPERATION_LABELS.ADD_EMPLOYEE_TO_DEVICE} "${truncatedName}" (candidato ${candidateId})`;
  const id = await createOperation({
    kind: "ADD_EMPLOYEE_TO_DEVICE",
    label,
    devId,
    userId: opUserKey,
    params: { employeeId: input.employeeId },
    plan: {
      phase: "probe",
      candidateId,
      attempt: 1,
      userName: truncatedName,
      privilege,
      pendingFingers,
      pushedFingers: [],
      failedFingers: [],
    },
  });
  await queueCommandForOperation(id, devId, "GET_USER_INFO", { user_id: String(candidateId) });
  return { id, warning };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface OperationRowWithDevice extends OperationRow {
  device_last_seen_at: number | null;
}

function toView(row: OperationRowWithDevice): OperationView {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    dev_id: row.dev_id,
    user_id: row.user_id,
    stage: row.stage,
    step_index: row.step_index,
    step_total: row.step_total,
    result_note: row.result_note,
    error_note: row.error_note,
    isTerminal: TERMINAL_STAGES.has(row.stage),
    stageLabel: STAGE_LABELS[row.stage],
    progressLabel: row.step_total > 1 ? `Paso ${row.step_index} de ${row.step_total}` : "",
    deviceOnline: isDeviceOnline(row.device_last_seen_at),
    ageMs: Date.now() - row.created_at,
    note: row.error_note ?? row.result_note,
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at,
  };
}

const OPERATION_SELECT = `
  SELECT o.*, d.last_seen_at AS device_last_seen_at
    FROM operations o
    LEFT JOIN devices d ON d.dev_id = o.dev_id
`;

export async function listActiveOperations(devId?: string): Promise<OperationView[]> {
  await initDb();
  await sweepStaleOperations();
  const rows = await allAsync<OperationRowWithDevice>(
    `${OPERATION_SELECT}
      WHERE o.stage NOT IN ('done','mismatch','error','canceled')
        ${devId ? "AND o.dev_id = ?" : ""}
      ORDER BY o.created_at DESC`,
    devId ? [devId] : []
  );
  return rows.map(toView);
}

export async function listRecentOperations(
  opts: { devId?: string; limit?: number } = {}
): Promise<OperationView[]> {
  await initDb();
  const limit = opts.limit ?? 30;
  const rows = await allAsync<OperationRowWithDevice>(
    `${OPERATION_SELECT}
      ${opts.devId ? "WHERE o.dev_id = ?" : ""}
      ORDER BY o.created_at DESC LIMIT ?`,
    opts.devId ? [opts.devId, limit] : [limit]
  );
  return rows.map(toView);
}

export async function getOperation(id: number): Promise<OperationView | null> {
  await initDb();
  const row = await getAsync<OperationRowWithDevice>(`${OPERATION_SELECT} WHERE o.id = ?`, [id]);
  return row ? toView(row) : null;
}

export interface OperationCommandRow {
  trans_id: number;
  cmd_code: string;
  status: string;
  cmd_param: string | null;
  result_json: string | null;
  cmd_return_code: string | null;
  created_at: number;
  updated_at: number;
}

export async function getOperationCommands(id: number): Promise<OperationCommandRow[]> {
  await initDb();
  return allAsync<OperationCommandRow>(
    `SELECT trans_id, cmd_code, status, cmd_param, result_json, cmd_return_code, created_at, updated_at
       FROM commands WHERE op_id = ? ORDER BY trans_id ASC`,
    [id]
  );
}

export async function cancelOperation(id: number): Promise<{ ok: boolean; reason?: string }> {
  await initDb();
  const op = await getOperationRow(id);
  if (!op) return { ok: false, reason: "La operación no existe." };
  if (TERMINAL_STAGES.has(op.stage)) return { ok: false, reason: "La operación ya terminó." };
  if (!op.current_trans_id) return { ok: false, reason: "No hay un comando en curso para cancelar." };

  // Also cancels a command already delivered to the device ('RUN'), not
  // just one still 'WAIT'ing — this used to refuse that case, but there's
  // nothing unsafe about it: canceling here can't un-send a command the
  // device already has, it only closes our side. If the device reports
  // back anyway afterward, the same terminal-stage guard that protects the
  // stale-sweep's timeouts (advanceOperationForCommand) ignores it. Without
  // this, an operation whose device never responds — which the user has
  // observed happening for real, not hypothetically — is stuck until the
  // 3-10 minute stale-sweep gets to it, with no way to close it sooner.
  const { changes } = await runAsync(
    `UPDATE commands SET status = 'ERROR', cmd_return_code = 'CANCELED',
            updated_at = ${NOW_MS}
      WHERE trans_id = ? AND status IN ('WAIT','RUN')`,
    [op.current_trans_id]
  );
  if (changes === 0) {
    // The command already got a real result; the operation just hasn't
    // caught up to it yet (a narrow race, not the common case).
    return { ok: false, reason: "El comando ya tiene una respuesta; la operación se actualizará sola." };
  }
  await finishOperation(id, "canceled", "Cancelada manualmente.");
  return { ok: true };
}
