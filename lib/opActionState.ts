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
