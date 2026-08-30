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
  params: Record<string, unknown> = {}
): Promise<number> {
  const { lastID } = await runAsync(
    `INSERT INTO commands (dev_id, cmd_code, cmd_param, status, op_id)
     VALUES (?, ?, ?, 'WAIT', ?)
     RETURNING trans_id`,
    [devId, cmdCode, JSON.stringify(params), opId]
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
}

export async function createOperation(input: CreateOperationInput): Promise<number> {
  const { lastID } = await runAsync(
    `INSERT INTO operations (kind, label, dev_id, user_id, params_json, step_total, plan_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [
      input.kind,
      input.label,
      input.devId,
      input.userId ?? null,
      input.params ? JSON.stringify(input.params) : null,
      input.stepTotal ?? 1,
      input.plan !== undefined ? JSON.stringify(input.plan) : null,
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
}

export function getOperationRow(opId: number): Promise<OperationRow | undefined> {
  return getAsync<OperationRow>(`SELECT * FROM operations WHERE id = ?`, [opId]);
}
