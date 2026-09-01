/**
 * Estado compartido para los formularios de CRUD del admin (useActionState).
 * Vive fuera de los archivos "use server" porque Next solo permite exportar
 * funciones async desde ahí. Espeja lib/opActionState.ts.
 */
export type AdminActionState =
  | { status: "idle" }
  | { status: "ok"; message?: string }
  | { status: "error"; error: string };

export const ADMIN_ACTION_INITIAL: AdminActionState = { status: "idle" };
