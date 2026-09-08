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
  | "REFRESH_STATUS"
  | "CAPTURE_FINGERPRINT"
  | "PUSH_FINGERPRINT"
  | "ADD_EMPLOYEE_TO_DEVICE";

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

// El equipo físico tiene un tercer nivel en su propia pantalla ("Super
// Usuario", confirmado 2026-09-08 que es el string de protocolo "OPERATOR" —
// se asignó "Super Usuario" desde el teclado del equipo y GET_USER_INFO lo
// reportó como "OPERATOR") pero SET_USER_PRIVILEGE no puede escribirlo de
// forma remota: devuelve cmd_return_code:OK y el equipo queda en USER de
// todas formas, sin error visible. Es una limitación de escritura, no de que
// el valor no exista — ver docs/05-commands-catalog.md → SET_USER_PRIVILEGE.
// El tipo solo declara los dos valores que de verdad se pueden asignar por
// este comando.
export type Privilege = "USER" | "MANAGER";

// Nombres en español que la persona ve en la pantalla del equipo — no el
// string crudo del protocolo. Incluye "OPERATOR" (no asignable por
// SET_USER_PRIVILEGE, pero sí puede aparecer como valor ya asignado
// físicamente) para que el panel lo muestre igual de bien al leerlo.
export const PRIVILEGE_SCREEN_LABEL: Record<string, string> = {
  USER: "Usuario",
  MANAGER: "Admin",
  OPERATOR: "Super Usuario",
};

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
  CAPTURE_FINGERPRINT: "Capturar huella",
  PUSH_FINGERPRINT: "Copiar huella a otro equipo",
  ADD_EMPLOYEE_TO_DEVICE: "Agregar empleado al equipo",
};

// Cuántos IDs numéricos consecutivos se prueban como máximo antes de rendirse
// y pedir uno manual — cada intento sobre un ID YA ocupado responde rápido
// (verificado contra hardware real), así que este tope no implica N × 3
// minutos en la práctica, solo en el peor caso patológico.
export const MAX_ID_ASSIGNMENT_ATTEMPTS = 5;

// 0-9 = dedos (verificado: WS535BW1_BSCS_v1.5.31 solo entrega la forma limpia
// de 612 bytes por GET_USER_INFO para este rango; 10/11/12 = password/tarjeta/
// rostro, fuera de alcance de la migración de huellas por ahora — ver
// docs/05-commands-catalog.md).
export const MAX_FINGERPRINT_INDEX = 9;

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
