// The only place in the operations layer that writes to `commands`. Keeping
// this narrow means the device-facing hot path (protocol-handlers.ts) only
// has to trust one insertion point when it looks up an operation by
// `current_trans_id`.

import { runAsync, getAsync, NOW_MS } from "@/lib/db";
import { OperationKind, OperationStage } from "./kinds";

export async function queueCommandForOperation(
  opId: number,
  devId: string,
  cmdCode: string,
  params: Record<string, unknown> = {},
  binary: Buffer | null = null
): Promise<number> {
  // El comando hereda la prioridad de su operación (docs/10 §3.1): lo del
  // reconciliador (200) no le gana la cola a lo que pide el panel (100).
  const { lastID } = await runAsync(
    `INSERT INTO commands (dev_id, cmd_code, cmd_param, cmd_binary, status, op_id, priority)
     VALUES (?, ?, ?, ?, 'WAIT', ?, COALESCE((SELECT priority FROM operations WHERE id = ?), 100))
     RETURNING trans_id`,
    [devId, cmdCode, JSON.stringify(params), binary, opId, opId]
  );
  await runAsync(
    `UPDATE operations
        SET current_trans_id = ?, updated_at = ${NOW_MS}
      WHERE id = ?`,
    [lastID, opId]
  );
  return lastID;
}

export interface CreateOperationInput {
  kind: OperationKind;
  label: string;
  devId: string;
  userId?: string | null;
  params?: Record<string, unknown>;
  stepTotal?: number;
  plan?: unknown;
  /** 100 = panel (default), 200 = reconciliador / segundo plano. Menor sale primero. */
  priority?: number;
}

/** Prioridad de las operaciones que lanza el reconciliador (docs/10 §3.1). */
export const BACKGROUND_PRIORITY = 200;

export async function createOperation(input: CreateOperationInput): Promise<number> {
  const { lastID } = await runAsync(
    `INSERT INTO operations (kind, label, dev_id, user_id, params_json, step_total, plan_json, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      input.kind,
      input.label,
      input.devId,
      input.userId ?? null,
      input.params ? JSON.stringify(input.params) : null,
      input.stepTotal ?? 1,
      input.plan !== undefined ? JSON.stringify(input.plan) : null,
      input.priority ?? 100,
    ]
  );
  return lastID;
}

export interface SetStagePatch {
  stepIndex?: number;
  stepTotal?: number;
  plan?: unknown;
  resultNote?: string;
  errorNote?: string;
  currentTransId?: number | null;
  lastTransId?: number;
}

export async function setStage(
  opId: number,
  stage: OperationStage,
  patch: SetStagePatch = {}
): Promise<void> {
  const sets: string[] = ["stage = ?", `updated_at = ${NOW_MS}`];
  const params: unknown[] = [stage];

  if (patch.stepIndex !== undefined) {
    sets.push("step_index = ?");
    params.push(patch.stepIndex);
  }
  if (patch.stepTotal !== undefined) {
    sets.push("step_total = ?");
    params.push(patch.stepTotal);
  }
  if (patch.plan !== undefined) {
    sets.push("plan_json = ?");
    params.push(JSON.stringify(patch.plan));
  }
  if (patch.resultNote !== undefined) {
    sets.push("result_note = ?");
    params.push(patch.resultNote);
  }
  if (patch.errorNote !== undefined) {
    sets.push("error_note = ?");
    params.push(patch.errorNote);
  }
  if (patch.currentTransId !== undefined) {
    sets.push("current_trans_id = ?");
    params.push(patch.currentTransId);
  }
  if (patch.lastTransId !== undefined) {
    sets.push("last_trans_id = ?");
    params.push(patch.lastTransId);
  }

  params.push(opId);
  await runAsync(`UPDATE operations SET ${sets.join(", ")} WHERE id = ?`, params);
}

export async function finishOperation(
  opId: number,
  stage: "done" | "mismatch" | "error" | "canceled",
  note: string
): Promise<void> {
  const noteColumn = stage === "error" || stage === "canceled" ? "error_note" : "result_note";
  await runAsync(
    `UPDATE operations
        SET stage = ?, ${noteColumn} = ?, current_trans_id = NULL,
            finished_at = ${NOW_MS}, updated_at = ${NOW_MS}
      WHERE id = ?`,
    [stage, note, opId]
  );
  // La corrida (sync_run) que lanzó esta operación se cierra con ella. El
  // reconciliador ya cierra la suya con estadísticas antes de llegar acá (la
  // condición finished_at IS NULL la deja intacta); esto cubre el pull de
  // asistencia y cualquier operación que expira sin respuesta del equipo, que
  // antes dejaban la corrida abierta para siempre (ok = null).
  await runAsync(
    `UPDATE sync_run
        SET finished_at = now(), ok = ?,
            stats = COALESCE(stats, '{}'::jsonb) || jsonb_build_object(?::text, ?::text)
      WHERE op_id = ? AND finished_at IS NULL`,
    [stage === "done", stage === "done" ? "note" : "error", note, opId]
  );
}

export interface OperationRow {
  id: number;
  kind: OperationKind;
  label: string;
  dev_id: string;
  user_id: string | null;
  params_json: string | null;
  stage: OperationStage;
  step_index: number;
  step_total: number;
  plan_json: string | null;
  current_trans_id: number | null;
  last_trans_id: number | null;
  result_note: string | null;
  error_note: string | null;
  created_at: number;
  updated_at: number;
  finished_at: number | null;
  priority: number;
}

export function getOperationRow(opId: number): Promise<OperationRow | undefined> {
  return getAsync<OperationRow>(`SELECT * FROM operations WHERE id = ?`, [opId]);
}
