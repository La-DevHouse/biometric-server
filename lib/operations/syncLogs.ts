// Traer marcaciones de un equipo (SYNC_LOGS), en lotes: cada lote se guarda aparte,
// así un corte solo cuesta ese lote y no toda la lectura (el servidor guarda una
// respuesta entera o nada, y lo que llega después de vencer la operación se pierde).
//
//   year  → el último año, de a trimestres, del más reciente al más viejo. Lo que usa
//           un equipo la primera vez y el botón del panel.
//   since → desde una fecha (el pull diario). Un solo lote, salvo que falle.
//   full  → toda la memoria de una vez, sin límite de antigüedad (solo administradores).
//
// Un lote que falla o llega incompleto (anuncia más marcaciones de las que manda) se
// divide por meses y se sigue con los demás; lo que aun así falte queda en la nota final.
//
// Los faciales con dev_id placeholder ignoran el rango y mandan toda la memoria
// (docs/04): se les pide una sola vez, y de lo que mandan se guarda solo el último
// año. Lo mismo si un equipo normal resulta ignorar el rango: se detecta en la
// primera respuesta y no se le pide nada más.
//
// "Liberar memoria" NO usa esto: lee siempre todo (lib/operations/clearLogs).
import { runAsync, getAsync, NOW_MS } from "@/lib/db";
import { decodeLogData } from "@/lib/protocol";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { finishOperation, queueCommandForOperation, setStage, type OperationRow } from "./queue";
import { insertAttendanceLogs } from "./persist";
import type { AdvanceStep } from "./clearLogs";

/** Rango de un GET_LOG_DATA, "YYYYMMDD". Los lotes vecinos comparten el día del borde (el duplicado se descarta). */
export interface LogWindow {
  from: string;
  to: string;
  /** Ya es la división por meses de un trimestre: si falla, no se divide más. */
  month?: boolean;
}

export type SyncLogsMode = "year" | "since" | "full";

export interface SyncLogsPlan {
  mode: SyncLogsMode;
  /** Lo anterior a esta fecha no se guarda ("YYYYMMDD"; sin valor = todo). */
  cutoff?: string;
  /** El lote pedido. null = sin rango. Si la operación se corta, de acá se retoma. */
  current: LogWindow | null;
  pending: LogWindow[];
  /** Lecturas que respondieron bien. */
  reads: number;
  read: number;
  inserted: number;
  skipped: number;
  /** Marcaciones que mandó el equipo con más antigüedad que `cutoff`. */
  older: number;
  ignoresRange?: boolean;
  failed: Array<{ from: string | null; to: string | null; reason: string }>;
}

const compact = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
const parse = (ymd: string) => new Date(Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(4, 6)) - 1, Number(ymd.slice(6, 8))));

function addMonths(ymd: string, months: number): string {
  const d = parse(ymd);
  d.setUTCMonth(d.getUTCMonth() + months);
  return compact(d);
}

function addDays(ymd: string, days: number): string {
  const d = parse(ymd);
  d.setUTCDate(d.getUTCDate() + days);
  return compact(d);
}

const todayCompact = () => dateKeyInTz(new Date(), DEFAULT_TZ).replace(/-/g, "");

/** Hasta dónde se importa: hoy hace un año ("YYYYMMDD"). */
export function yearCutoff(today: string = todayCompact()): string {
  return addMonths(today, -12);
}

/** Los 4 trimestres del último año, del más reciente al más viejo (el último llega hasta mañana). */
export function quarterWindows(today: string = todayCompact()): LogWindow[] {
  const start = yearCutoff(today);
  const out: LogWindow[] = [];
  for (let i = 0; i < 4; i++) {
    out.unshift({ from: addMonths(start, i * 3), to: i === 3 ? addDays(today, 1) : addMonths(start, (i + 1) * 3) });
  }
  return out;
}

/** Un lote dividido por meses, del más reciente al más viejo. */
export function monthWindows(w: LogWindow): LogWindow[] {
  const out: LogWindow[] = [];
  for (let i = 0; ; i++) {
    const from = addMonths(w.from, i);
    if (from >= w.to) break;
    const next = addMonths(w.from, i + 1);
    out.unshift({ from, to: next < w.to ? next : w.to, month: true });
  }
  return out;
}

const emptyPlan = (mode: SyncLogsMode, current: LogWindow | null, pending: LogWindow[], cutoff?: string): SyncLogsPlan => ({
  mode,
  cutoff,
  current,
  pending,
  reads: 0,
  read: 0,
  inserted: 0,
  skipped: 0,
  older: 0,
  failed: [],
});

export const fullPlan = () => emptyPlan("full", null, []);

export function sincePlan(since: Date): SyncLogsPlan {
  return emptyPlan("since", { from: compact(since), to: compact(new Date(Date.now() + 24 * 3600 * 1000)) }, [], yearCutoff());
}

export function yearPlan(ignoresRange: boolean, today: string = todayCompact()): SyncLogsPlan {
  if (ignoresRange) return emptyPlan("year", null, [], yearCutoff(today));
  const [current, ...pending] = quarterWindows(today);
  return emptyPlan("year", current, pending, yearCutoff(today));
}

/** Parámetros del GET_LOG_DATA de un lote. */
export function logDataParams(w: LogWindow | null): Record<string, string> {
  return w ? { begin_time: w.from, end_time: w.to } : {};
}

export const planSteps = (plan: SyncLogsPlan) => plan.reads + plan.failed.length + plan.pending.length + 1;

/** La última importación del año de este equipo, si se cortó (equipo desconectado) sin terminar. */
export async function interruptedYearPlan(devId: string): Promise<SyncLogsPlan | null> {
  const row = await getAsync<{ stage: string; plan_json: string | null }>(
    `SELECT stage, plan_json FROM operations
      WHERE kind = 'SYNC_LOGS' AND dev_id = ? AND plan_json LIKE '%"mode":"year"%'
      ORDER BY id DESC LIMIT 1`,
    [devId]
  );
  if (!row?.plan_json || row.stage !== "error") return null;
  const plan: SyncLogsPlan = JSON.parse(row.plan_json);
  return plan.current ? plan : null;
}

const fmt = (ymd: string) => `${ymd.slice(6, 8)}/${ymd.slice(4, 6)}/${ymd.slice(0, 4)}`;

function summary(plan: SyncLogsPlan): string {
  const parts: string[] = [];
  if (plan.read === 0) {
    parts.push(plan.mode === "year" ? "El equipo no reportó marcaciones del último año." : "El equipo no reportó marcaciones.");
  } else {
    parts.push(`${plan.read} registros leídos del equipo: ${plan.inserted} nuevos, ${plan.skipped} ya estaban registrados.`);
  }
  if (plan.older > 0) parts.push(`${plan.older} de más de un año no se importaron.`);
  if (plan.mode === "year" && plan.ignoresRange) parts.push("Este equipo no filtra por fechas: se leyó toda su memoria de una vez.");
  if (plan.mode !== "since" && plan.inserted > 0) {
    parts.push("Para que las de hace más de 35 días cuenten en la asistencia, use “Recalcular asistencia” con ese período en la empresa.");
  }
  if (plan.failed.length > 0) {
    const list = plan.failed.map((f) => (f.from && f.to ? `del ${fmt(f.from)} al ${fmt(f.to)} (${f.reason})` : `la memoria del equipo (${f.reason})`));
    parts.push(`No se pudo leer completo: ${list.join("; ")}. Vuelva a sincronizar para reintentar.`);
  }
  return parts.join(" ");
}

export async function advanceSyncLogs(op: OperationRow, input: AdvanceStep): Promise<void> {
  // Una operación creada antes de los lotes no tiene plan: era una sola lectura completa.
  const plan: SyncLogsPlan = op.plan_json ? JSON.parse(op.plan_json) : fullPlan();
  const w = plan.current;

  // Un rango sin marcaciones llega con log_count 0 y sin binario: eso es "nada nuevo", no un error.
  const empty = input.ok && Number(input.resultJson?.log_count) === 0;
  const decoded = !input.ok ? null : empty ? [] : input.resultJson ? decodeLogData(input.resultJson, input.binaries) : null;

  let problem: string | null = null;
  if (!input.ok) problem = input.returnCode === "TIMEOUT" ? "el equipo no respondió" : `el equipo devolvió ${input.returnCode}`;
  else if (decoded === null) problem = "no se pudo leer la respuesta";

  if (decoded) {
    const cutoff = plan.cutoff;
    const entries = cutoff ? decoded.filter((e) => e.io_time >= cutoff) : decoded;
    const saved = await insertAttendanceLogs(op.dev_id, entries);
    plan.reads++;
    plan.read += saved.total;
    plan.inserted += saved.inserted;
    plan.skipped += saved.skipped;
    plan.older += decoded.length - entries.length;
    // Resolver a quién pertenece cada marcaje por cédula (user_id = cédula, docs/10 §4.6).
    await runAsync(
      `UPDATE attendance_logs al SET employee_id = e.id
         FROM employee e
        WHERE al.dev_id = ? AND al.employee_id IS NULL
          AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id`,
      [op.dev_id]
    );
    const announced = Number(input.resultJson?.log_count);
    if (Number.isFinite(announced) && announced > decoded.length) {
      problem = `el equipo anunció ${announced} y envió ${decoded.length}`;
    }
    // Mandó anteriores al inicio del rango: no filtra por fechas y esto ya es toda su
    // memoria (1 día de margen, por si el borde depende de la zona horaria del equipo).
    if (w && decoded.some((e) => e.io_time.slice(0, 8) < addDays(w.from, -1))) {
      plan.ignoresRange = true;
      plan.pending = [];
    }
  }

  if (problem) {
    const months = w && !w.month && !plan.ignoresRange ? monthWindows(w) : [];
    if (months.length > 1) plan.pending = [...months, ...plan.pending];
    else plan.failed.push({ from: w?.from ?? null, to: w?.to ?? null, reason: problem });
  }

  const next = plan.pending.shift();
  if (next) {
    plan.current = next;
    await setStage(op.id, "sent", { plan, stepIndex: plan.reads + plan.failed.length, stepTotal: planSteps(plan) });
    await queueCommandForOperation(op.id, op.dev_id, "GET_LOG_DATA", logDataParams(next));
    return;
  }

  plan.current = null;
  await setStage(op.id, op.stage, { plan });
  // Última sync EXITOSA de marcajes (≠ heartbeat last_seen_at) — docs/07 §1.6. Va al
  // final: mientras la importación no termina, el equipo cuenta como pendiente.
  if (plan.reads > 0) await runAsync(`UPDATE devices SET last_sync_at = ${NOW_MS} WHERE dev_id = ?`, [op.dev_id]);
  await finishOperation(op.id, plan.failed.length > 0 ? "error" : "done", summary(plan));
}
