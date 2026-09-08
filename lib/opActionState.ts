/**
 * Lives outside app/admin/actions.ts on purpose: a "use server" file may
 * only export async functions (Next.js enforces this at build time), so the
 * shared state type + its initial value for useActionState have to sit in a
 * plain module instead.
 */
export type OpActionState =
  | { status: "idle" }
  | { status: "ok"; id: number; warning?: string }
  | { status: "error"; message: string };

export const OP_ACTION_INITIAL: OpActionState = { status: "idle" };

/**
 * Para acciones que disparan una operación POR equipo elegido (selección
 * múltiple) en vez de una sola — ver AddEmployeeToDeviceDialog. `warning`
 * acumula tanto avisos como errores por-equipo (ej. "ya vinculado en X"),
 * separado del `status: "error"` general, que solo se usa si NINGÚN equipo
 * pudo iniciar la operación.
 */
export type MultiOpActionState =
  | { status: "idle" }
  | { status: "ok"; ids: number[]; warning?: string }
  | { status: "error"; message: string };

export const MULTI_OP_ACTION_INITIAL: MultiOpActionState = { status: "idle" };
