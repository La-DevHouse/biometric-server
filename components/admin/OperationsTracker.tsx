"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/lib/cx";
import { formatRelativeTime, formatDateTime } from "@/lib/formatRelativeTime";
import type { OperationStepView, TrackedOperationView } from "@/lib/operations";

/**
 * Panel global "Procesando" — reemplaza el patrón anterior de dejar cada
 * diálogo bloqueado hasta que el equipo respondía. Una operación encolada se
 * entrega al tracker y el diálogo se cierra al instante; el panel (esquina
 * inferior, no modal) muestra cada operación en curso con su paso actual y
 * el detalle de cada comando mandado al equipo, deja el resultado final
 * visible hasta que se descarta, y refresca la página cuando algo termina.
 *
 * También muestra operaciones que este navegador no lanzó (otro usuario, el
 * fan-out automático de un contrato) y sobrevive a una recarga: cada ciclo
 * pide al servidor todas las activas más las que ya venía siguiendo.
 */

const POLL_MS = 1500;
const IDLE_POLL_MS = 5000;
/** Contraído y sin nada en curso: se oculta tras este tiempo sin cambios. */
const AUTO_HIDE_MS = 10_000;
/** Duración de la animación de salida — las terminadas se limpian recién después, para no saltar el contenido mientras baja. */
const EXIT_MS = 500;

interface TrackerContextValue {
  /** Empezar a seguir operaciones recién encoladas (con el aviso de arranque, si hubo). */
  track: (ids: number[], warning?: string | null) => void;
}

const TrackerContext = createContext<TrackerContextValue | null>(null);

export function useOperationsTracker(): TrackerContextValue {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error("useOperationsTracker must be used inside <OperationsTrackerProvider>");
  return ctx;
}

const CMD_LABEL: Record<string, (s: OperationStepView) => string> = {
  GET_DEVICE_STATUS: () => "Leer estado del equipo",
  GET_USER_ID_LIST: () => "Leer lista de usuarios",
  GET_USER_INFO: (s) => `Consultar usuario ${s.user_id ?? ""}`.trim(),
  SET_USER_INFO: (s) => `Crear usuario ${s.user_id ?? ""}`.trim(),
  DELETE_USER: (s) => `Borrar usuario ${s.user_id ?? ""}`.trim(),
  SET_ENROLL_DATA: (s) =>
    `Escribir huella${s.backup_number !== null ? ` (slot ${s.backup_number})` : ""} en ${s.user_id ?? "usuario"}`,
  GET_ENROLL_DATA: (s) => `Leer huella de ${s.user_id ?? "usuario"}`,
  SET_USER_NAME: (s) => `Renombrar usuario ${s.user_id ?? ""}`.trim(),
  SET_USER_PRIVILEGE: (s) => `Cambiar privilegio de ${s.user_id ?? "usuario"}`,
  SET_TIME: () => "Ajustar reloj",
  SET_FK_NAME: () => "Renombrar equipo",
  GET_LOG_DATA: () => "Leer marcaciones",
  CLEAR_LOG_DATA: () => "Borrar marcaciones del equipo",
  CLEAR_ENROLL_DATA: () => "Borrar biométricos del equipo",
};

function stepLabel(s: OperationStepView): string {
  return CMD_LABEL[s.cmd_code]?.(s) ?? s.cmd_code;
}

function stepOutcome(s: OperationStepView): { text: string; tone: string } {
  if (s.status === "WAIT") return { text: "en cola", tone: "text-text/60" };
  if (s.status === "RUN") return { text: "esperando respuesta…", tone: "text-text/75" };
  if (s.status === "RESULT") {
    return s.cmd_return_code && s.cmd_return_code !== "OK"
      ? { text: s.cmd_return_code, tone: "text-accent2" }
      : { text: "OK", tone: "text-accent" };
  }
  if (s.cmd_return_code === "TIMEOUT") return { text: "sin respuesta", tone: "text-accent2" };
  if (s.cmd_return_code === "CANCELED") return { text: "cancelado", tone: "text-text/60" };
  return { text: s.cmd_return_code ?? "error", tone: "text-accent2" };
}

const RESULT_TONE: Record<string, string> = {
  done: "text-accent",
  mismatch: "text-accent2",
  error: "text-danger-600",
  canceled: "text-text/75",
};

interface Entry {
  op: TrackedOperationView;
  warning: string | null;
}

export function OperationsTrackerProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Map<number, Entry>>(new Map());
  // Contraído por defecto: el panel avisa sin tapar la página; se expande a pedido.
  const [collapsed, setCollapsed] = useState(true);
  // Oculto (animación de salida) tras AUTO_HIDE_MS de inactividad estando contraído.
  const [hidden, setHidden] = useState(false);
  // Sube con cada cambio real (operación nueva, cambio de paso/estado) — reinicia el contador.
  const [activity, setActivity] = useState(0);
  const [hovered, setHovered] = useState(false);
  // ids a seguir aunque todavía no hayan vuelto del servidor, con su aviso de arranque
  const pendingRef = useRef<Map<number, string | null>>(new Map());
  const dismissedRef = useRef<Set<number>>(new Set());
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<() => void>(() => {});

  const tick = useCallback(async () => {
    const known = [...entriesRef.current.values()];
    const ids = new Set<number>([
      ...pendingRef.current.keys(),
      ...known.filter((e) => !e.op.isTerminal).map((e) => e.op.id),
    ]);
    let ops: TrackedOperationView[] = [];
    try {
      const res = await fetch(`/api/operations?ids=${[...ids].join(",")}`, { cache: "no-store" });
      if (res.ok) ops = ((await res.json()) as { ops: TrackedOperationView[] }).ops;
    } catch {
      // red caída: se reintenta en el próximo ciclo
    }

    // Se arma el mapa nuevo acá (no dentro de un updater de setState, que
    // corre recién en el próximo render) para saber ya si algo terminó.
    let finishedSomething = false;
    let changed = false;
    const next = new Map(entriesRef.current);
    for (const op of ops) {
      if (dismissedRef.current.has(op.id)) continue;
      const before = next.get(op.id);
      if (!before || before.op.updated_at !== op.updated_at || before.op.stage !== op.stage) changed = true;
      // Terminó mientras se seguía — o se empezó a seguir y ya volvió terminada.
      if ((before && !before.op.isTerminal) || (!before && pendingRef.current.has(op.id))) {
        if (op.isTerminal) finishedSomething = true;
      }
      const warning = before?.warning ?? pendingRef.current.get(op.id) ?? null;
      next.set(op.id, { op, warning });
      pendingRef.current.delete(op.id);
    }
    entriesRef.current = next;
    setEntries(next);
    if (changed) setActivity((n) => n + 1);
    if (finishedSomething) router.refresh();

    const anyRunning = ops.some((o) => !o.isTerminal) || pendingRef.current.size > 0;
    timerRef.current = setTimeout(() => tickRef.current(), anyRunning ? POLL_MS : IDLE_POLL_MS);
  }, [router]);

  useEffect(() => {
    tickRef.current = () => void tick();
    tickRef.current();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [tick]);

  const track = useCallback((ids: number[], warning?: string | null) => {
    for (const id of ids) {
      dismissedRef.current.delete(id);
      pendingRef.current.set(id, warning ?? null);
    }
    setActivity((n) => n + 1);
    // Sondeo inmediato, sin esperar al ciclo lento de reposo.
    if (timerRef.current) clearTimeout(timerRef.current);
    tickRef.current();
  }, []);

  function dismiss(id: number) {
    dismissedRef.current.add(id);
    const next = new Map(entriesRef.current);
    next.delete(id);
    entriesRef.current = next;
    setEntries(next);
  }

  const clearFinished = useCallback(() => {
    for (const e of entriesRef.current.values()) if (e.op.isTerminal) dismissedRef.current.add(e.op.id);
    const next = new Map([...entriesRef.current].filter(([, e]) => !e.op.isTerminal));
    entriesRef.current = next;
    setEntries(next);
  }, []);

  /**
   * Cerrar (× o auto-ocultado): baja el panel y, al terminar la animación,
   * descarta las terminadas. Las que siguen en curso quedan seguidas y el
   * panel vuelve a aparecer con su próxima actividad.
   */
  const closePanel = useCallback(() => {
    setHidden(true);
    setTimeout(clearFinished, EXIT_MS);
  }, [clearFinished]);

  // Reloj para los "hace X min": re-render cada 30 s aunque no haya polling
  // (el panel deja de consultar cuando no queda nada en curso).
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const list = [...entries.values()].sort((a, b) => b.op.created_at - a.op.created_at);
  const running = list.filter((e) => !e.op.isTerminal).length;

  // Cualquier actividad lo vuelve a mostrar (y reinicia el contador de abajo).
  const [seenActivity, setSeenActivity] = useState(activity);
  if (seenActivity !== activity) {
    setSeenActivity(activity);
    setHidden(false);
  }

  // Auto-ocultar: solo contraído, sin nada en curso y sin el mouse encima.
  useEffect(() => {
    if (!collapsed || running > 0 || hovered || hidden || list.length === 0) return;
    const t = setTimeout(closePanel, AUTO_HIDE_MS);
    return () => clearTimeout(t);
  }, [collapsed, running, hovered, hidden, list.length, activity, closePanel]);

  return (
    <TrackerContext.Provider value={{ track }}>
      {children}
      {list.length > 0 && (
        <aside
          aria-live="polite"
          aria-hidden={hidden}
          inert={hidden}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          className={cx(
            "fixed z-40 bottom-4 right-4 w-[min(calc(100vw-2rem),26rem)] border border-text bg-surface shadow-hard flex flex-col",
            // Entra deslizándose desde abajo (@starting-style) y sale bajando
            // con fundido; sin animación si el sistema pide menos movimiento.
            "transition-[translate,opacity] duration-500 ease-out motion-reduce:transition-none",
            "starting:translate-y-6 starting:opacity-0",
            hidden ? "translate-y-[calc(100%+1rem)] opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
          )}
        >
          <div className={cx("flex items-center justify-between gap-2 px-3 py-2 bg-chrome", !collapsed && "border-b border-divider")}>
            <span className="flex items-center gap-2 font-heading font-semibold text-sm">
              {running > 0 && <span className="w-2 h-2 rounded-full bg-accent animate-op-pulse" aria-hidden />}
              {running > 0 ? `Procesando · ${running}` : "Operaciones terminadas"}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={collapsed ? "Expandir" : "Contraer"}
                onClick={() => {
                  setCollapsed((c) => !c);
                  setActivity((n) => n + 1);
                }}
                className="w-7 h-7 flex items-center justify-center bg-transparent border border-neutral-500 hover:border-text cursor-pointer"
              >
                {collapsed ? "+" : "–"}
              </button>
              <button
                type="button"
                aria-label="Cerrar panel de operaciones"
                title="Cerrar (limpia las terminadas)"
                onClick={closePanel}
                className="w-7 h-7 flex items-center justify-center text-base leading-none bg-transparent border border-neutral-500 hover:border-text cursor-pointer"
              >
                ×
              </button>
            </span>
          </div>
          {!collapsed && (
            <ul className="list-none m-0 p-0 max-h-[50dvh] overflow-y-auto divide-y divide-divider">
              {list.map(({ op, warning }) => (
                <li key={op.id} className="p-3 flex flex-col gap-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="m-0 text-sm font-semibold leading-snug">{op.label}</p>
                      <p className="m-0 text-xs text-text/60">
                        <span className="font-mono">{op.dev_id}</span>
                        {" · "}
                        {/* Cuándo empezó (o terminó): el tooltip trae la fecha y hora exactas. */}
                        <time
                          dateTime={new Date(op.isTerminal && op.finished_at ? op.finished_at : op.created_at).toISOString()}
                          title={formatDateTime(op.isTerminal && op.finished_at ? op.finished_at : op.created_at)}
                        >
                          {op.isTerminal && op.finished_at
                            ? `terminó ${formatRelativeTime(op.finished_at, now)}`
                            : `iniciado ${formatRelativeTime(op.created_at, now)}`}
                        </time>
                      </p>
                    </div>
                    {op.isTerminal && (
                      <button
                        type="button"
                        aria-label="Descartar"
                        onClick={() => dismiss(op.id)}
                        className="w-6 h-6 flex-none flex items-center justify-center text-base leading-none bg-transparent border border-neutral-500 hover:border-text cursor-pointer"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  {op.isTerminal ? (
                    <p className={cx("m-0 text-sm", RESULT_TONE[op.stage] ?? "text-text")}>
                      {op.stage === "done" ? (op.note ?? "Listo.") : `${op.stageLabel}${op.note ? " — " + op.note : ""}`}
                    </p>
                  ) : (
                    <p className="m-0 text-sm flex items-center gap-2 text-text/85">
                      <span className="w-2 h-2 flex-none rounded-full bg-accent animate-op-pulse" aria-hidden />
                      {op.progressLabel ? `${op.progressLabel} · ` : ""}
                      {op.stageLabel}…
                      {!op.deviceOnline && <span className="text-accent2">(equipo desconectado)</span>}
                    </p>
                  )}
                  {warning && <p className="m-0 text-xs text-text/70">{warning}</p>}

                  {op.steps.length > 0 && (
                    <details open={!op.isTerminal} className="text-xs">
                      <summary className="cursor-pointer text-text/70 select-none">
                        Detalle ({op.steps.length} {op.steps.length === 1 ? "paso" : "pasos"})
                      </summary>
                      <ol className="m-0 mt-1 pl-5 flex flex-col gap-0.5">
                        {op.steps.map((s) => {
                          const out = stepOutcome(s);
                          return (
                            <li key={s.trans_id}>
                              {stepLabel(s)} — <span className={out.tone}>{out.text}</span>
                            </li>
                          );
                        })}
                      </ol>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}
    </TrackerContext.Provider>
  );
}
