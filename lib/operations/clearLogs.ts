// "Liberar memoria de marcaciones" de un equipo (CLEAR_LOGS) — borra SOLO las
// marcaciones de la memoria del equipo, nunca usuarios ni huellas, y nunca nada
// del servidor (attendance_logs es el archivo: lo que se borra del equipo queda acá).
//
// Cadena, cada paso solo si el anterior salió bien:
//   1. GET_DEVICE_STATUS  → cuántos usuarios / huellas / rostros / marcaciones tiene.
//                           0 marcaciones: nada que borrar (y un facial no responde
//                           GET_LOG_DATA vacío, docs/05).
//   2. GET_LOG_DATA       → todas las marcaciones al servidor.
//   3. verificación       → TODAS las leídas están en attendance_logs, y se leyeron al
//                           menos tantas como dijo el estado (si no, la respuesta pudo
//                           venir incompleta). Si algo falta: se detiene SIN borrar.
//   4. GET_DEVICE_STATUS  → justo antes de borrar: si entraron marcaciones nuevas desde
//                           la lectura, se vuelven a traer (hasta MAX_PULLS veces).
//   5. CLEAR_LOG_DATA     → borra las marcaciones del equipo (docs/05: solo logs).
//   6. GET_DEVICE_STATUS  → comprueba: usuarios, huellas y rostros IGUALES que en el
//                           paso 1, y marcaciones en 0 (o solo las que entraron después).
import { runAsync, getAsync, NOW_MS } from "@/lib/db";
import { decodeLogData, type DecodedLogEntry } from "@/lib/protocol";
import { finishOperation, queueCommandForOperation, setStage, type OperationRow } from "./queue";
import { insertAttendanceLogs } from "./persist";

export interface DeviceCounts {
  users: number | null;
  managers: number | null;
  fingerprints: number | null;
  faces: number | null;
  logs: number | null;
}

export interface ClearLogsPlan {
  phase: "before" | "pull" | "recheck" | "clear" | "after";
  before?: DeviceCounts;
  /** Marcaciones leídas del equipo y confirmadas en el servidor. */
  pulled?: number;
  pulls?: number;
}

/** Cuántas veces se vuelve a leer si entran marcaciones nuevas entre la lectura y el borrado. */
export const MAX_PULLS = 3;

const int = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
};

/** Conteos de un GET_DEVICE_STATUS (firmware real en snake_case, simulador en camelCase). */
export function countsFromStatus(json: Record<string, unknown> | null | undefined): DeviceCounts {
  const j = json ?? {};
  return {
    users: int(j.total_user_count ?? j.totalUserCount),
    managers: int(j.manager_count ?? j.managerCount),
    fingerprints: int(j.fp_count ?? j.fpCount),
    faces: int(j.face_count ?? j.faceCount),
    logs: int(j.total_log_count ?? j.totalLogCount),
  };
}

const LABEL: Record<keyof DeviceCounts, string> = {
  users: "usuarios",
  managers: "administradores",
  fingerprints: "huellas",
  faces: "rostros",
  logs: "marcaciones",
};

/**
 * Qué cambió de lo que NO se debe tocar (todo menos las marcaciones). Solo compara
 * lo que el equipo informó las dos veces. Vacío = intacto.
 */
export function untouchedDiff(before: DeviceCounts, after: DeviceCounts): string[] {
  const out: string[] = [];
  for (const k of ["users", "managers", "fingerprints", "faces"] as const) {
    if (before[k] != null && after[k] != null && before[k] !== after[k]) out.push(`${LABEL[k]}: ${before[k]} → ${after[k]}`);
  }
  return out;
}

/** Marcaciones distintas (dev, usuario, hora) — la misma clave única de attendance_logs. */
function distinctKeys(entries: DecodedLogEntry[]): DecodedLogEntry[] {
  const seen = new Set<string>();
  return entries.filter((e) => {
    const k = `${e.user_id}|${e.io_time}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** ¿Cuántas de estas marcaciones están guardadas en el servidor para ese equipo? */
async function storedCount(devId: string, entries: DecodedLogEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const r = await getAsync<{ n: number }>(
    `SELECT count(*)::int AS n
       FROM unnest(?::text[], ?::text[]) AS t(user_id, io_time)
      WHERE EXISTS (SELECT 1 FROM attendance_logs al WHERE al.dev_id = ? AND al.user_id = t.user_id AND al.io_time = t.io_time)`,
    [entries.map((e) => e.user_id), entries.map((e) => e.io_time), devId]
  );
  return Number(r?.n ?? 0);
}

export interface AdvanceStep {
  ok: boolean;
  returnCode: string;
  resultJson: Record<string, unknown> | null;
  binaries: Buffer[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function advanceClearLogs(op: OperationRow, input: AdvanceStep): Promise<void> {
  const plan: ClearLogsPlan = op.plan_json ? JSON.parse(op.plan_json) : { phase: "before" };
  const stop = (why: string) => finishOperation(op.id, "error", `${why} No se borró nada del equipo.`);
  const next = async (p: ClearLogsPlan, cmd: string, step: number, stage: "sent" | "verifying" = "sent") => {
    await setStage(op.id, stage, { plan: p, stepIndex: step });
    await queueCommandForOperation(op.id, op.dev_id, cmd, {});
  };

  switch (plan.phase) {
    case "before": {
      if (!input.ok) return stop(`El equipo devolvió ${input.returnCode} al leer su estado.`);
      const before = countsFromStatus(input.resultJson);
      if (before.logs === 0) {
        await finishOperation(op.id, "done", "El equipo no tiene marcaciones en memoria: no hay nada que borrar.");
        return;
      }
      return next({ phase: "pull", before, pulls: 0 }, "GET_LOG_DATA", 1);
    }

    case "pull": {
      if (!input.ok) return stop(`El equipo devolvió ${input.returnCode} al enviar sus marcaciones.`);
      const empty = Number(input.resultJson?.log_count) === 0;
      const decoded = empty ? [] : input.resultJson ? decodeLogData(input.resultJson, input.binaries) : null;
      if (decoded === null) return stop("No se pudieron leer las marcaciones del equipo.");
      const entries = distinctKeys(decoded);
      await insertAttendanceLogs(op.dev_id, entries);
      await runAsync(`UPDATE devices SET last_sync_at = ${NOW_MS} WHERE dev_id = ?`, [op.dev_id]);
      await runAsync(
        `UPDATE attendance_logs al SET employee_id = e.id
           FROM employee e
          WHERE al.dev_id = ? AND al.employee_id IS NULL
            AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id`,
        [op.dev_id]
      );
      const stored = await storedCount(op.dev_id, entries);
      if (stored !== entries.length) {
        return stop(`De ${entries.length} marcaciones leídas, solo ${stored} quedaron guardadas en el servidor.`);
      }
      // El equipo dijo tener N: si mandó menos, la respuesta pudo venir incompleta.
      const expected = plan.before?.logs ?? null;
      if (expected != null && decoded.length < expected) {
        return stop(`El equipo dijo tener ${expected} marcaciones pero envió ${decoded.length}.`);
      }
      return next({ ...plan, phase: "recheck", pulled: decoded.length, pulls: (plan.pulls ?? 0) + 1 }, "GET_DEVICE_STATUS", 2);
    }

    case "recheck": {
      if (!input.ok) return stop(`El equipo devolvió ${input.returnCode} al releer su estado.`);
      const now = countsFromStatus(input.resultJson);
      // Entraron marcaciones nuevas desde la lectura: se traen antes de borrar.
      if (now.logs != null && plan.pulled != null && now.logs > plan.pulled) {
        if ((plan.pulls ?? 0) >= MAX_PULLS) {
          return stop("El equipo sigue recibiendo marcaciones mientras se respaldan; intente en un momento con menos movimiento.");
        }
        return next({ ...plan, phase: "pull", before: { ...(plan.before as DeviceCounts), logs: now.logs } }, "GET_LOG_DATA", 1);
      }
      return next({ ...plan, phase: "clear" }, "CLEAR_LOG_DATA", 3);
    }

    case "clear": {
      // Aun si el equipo devuelve error, se lee el estado: puede haber borrado igual
      // (estos firmwares a veces mienten en el código de retorno), y hay que saberlo.
      return next({ ...plan, phase: "after" }, "GET_DEVICE_STATUS", 4, "verifying");
    }

    case "after": {
      if (!input.ok) {
        await finishOperation(op.id, "mismatch", "Se pidió borrar las marcaciones pero no se pudo leer el estado después para confirmarlo. Las marcaciones ya estaban respaldadas en el servidor.");
        return;
      }
      const after = countsFromStatus(input.resultJson);
      const changed = untouchedDiff(plan.before as DeviceCounts, after);
      if (changed.length) {
        await finishOperation(op.id, "error", `¡Atención! Cambió algo que no debía tocarse: ${changed.join(", ")}. Revise el equipo.`);
        return;
      }
      const pulled = plan.pulled ?? 0;
      if (after.logs != null && after.logs > 0 && after.logs >= pulled) {
        await finishOperation(op.id, "mismatch", `El equipo sigue con ${plural(after.logs, "marcación", "marcaciones")}: el borrado no se aplicó. Nada se perdió (están en el servidor).`);
        return;
      }
      const late = after.logs && after.logs > 0 ? ` Quedan ${plural(after.logs, "marcación nueva", "marcaciones nuevas")} que entraron después.` : "";
      await finishOperation(
        op.id,
        "done",
        `Memoria liberada: ${plural(pulled, "marcación respaldada", "marcaciones respaldadas")} en el servidor y borradas del equipo. Usuarios y huellas intactos.${late}`
      );
      return;
    }
  }
}
