// The catalogue of high-level operations the dashboard exposes, each mapping
// to one or more low-level device commands. This file only holds static
// facts about each kind (labels, step planning, validation) — no I/O. The
// actual orchestration lives in queue.ts (starting a chain) and advance.ts
// (reacting to each command's result).

export type OperationKind =
  | "SYNC_CLOCK"
  | "RENAME_DEVICE"
  | "SYNC_USERS"
  | "RENAME_USER"
  | "CHANGE_PRIVILEGE"
  | "CREATE_USER"
  | "DELETE_USER"
  | "SYNC_LOGS"
  | "CLEAR_LOGS"
  | "CLEAR_ENROLL"
  | "VIEW_BIOMETRICS"
  | "REFRESH_STATUS";

export type OperationStage =
  | "queued"
  | "sent"
  | "waiting"
  | "verifying"
  | "done"
  | "mismatch"
  | "error"
  | "canceled";

export const TERMINAL_STAGES: ReadonlySet<OperationStage> = new Set([
  "done",
  "mismatch",
  "error",
  "canceled",
]);

export type Privilege = "USER" | "MANAGER" | "OPERATOR" | "REGISTER";

// Firmware WS535BW1_BSCS_v1.5.31 only reliably applies MANAGER — sending
// OPERATOR returned cmd_return_code:OK but the device silently kept USER.
// Verified against real hardware; see docs/05-commands-catalog.md.
export const RELIABLE_PRIVILEGES: ReadonlySet<Privilege> = new Set([
  "USER",
  "MANAGER",
]);

// The device silently truncates user names to 8 characters — verified:
// "Jesus Renombrado" was stored as "Jesus Re". Applied before anything is
// sent, so the operation's own record of "what we asked for" already
// reflects reality.
export function truncateUserName(name: string): string {
  return name.slice(0, 8);
}

export const OPERATION_LABELS: Record<OperationKind, string> = {
  SYNC_CLOCK: "Sincronizar hora",
  RENAME_DEVICE: "Renombrar dispositivo",
  SYNC_USERS: "Sincronizar lista de usuarios",
  RENAME_USER: "Renombrar usuario",
  CHANGE_PRIVILEGE: "Cambiar privilegio",
  CREATE_USER: "Crear usuario nuevo",
  DELETE_USER: "Eliminar usuario",
  SYNC_LOGS: "Sincronizar historial completo",
  CLEAR_LOGS: "Borrar memoria de logs",
  CLEAR_ENROLL: "Borrar todos los biométricos",
  VIEW_BIOMETRICS: "Ver biométricos",
  REFRESH_STATUS: "Actualizar estado del dispositivo",
};

export const STAGE_LABELS: Record<OperationStage, string> = {
  queued: "En cola",
  sent: "Enviado al dispositivo",
  waiting: "Esperando al equipo",
  verifying: "Verificando…",
  done: "Completado",
  mismatch: "El dispositivo no aplicó el cambio",
  error: "Error",
  canceled: "Cancelada",
};
