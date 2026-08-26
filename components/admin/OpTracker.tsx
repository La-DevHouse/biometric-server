"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "./Toaster";
import { OPERATION_STARTED_EVENT } from "@/lib/opEvents";
import { cx } from "@/lib/cx";
import { cancelOperationAction } from "@/app/admin/actions";
import type { OperationView } from "@/lib/operations";

const POLL_MS = 2000;

/**
 * Self-scheduling poll instead of setInterval: after each fetch it only
 * schedules the next tick while there's something to show (active or just
 * finished). Once the list comes back empty the loop simply doesn't
 * reschedule — no requests hit the server while idle. A new operation
 * started elsewhere wakes it back up via OPERATION_STARTED_EVENT.
 */
export function OpTracker() {
  const [ops, setOps] = useState<OperationView[]>([]);
  const [canceling, setCanceling] = useState<Set<number>>(new Set());
  const prevStages = useRef<Map<number, string>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { push } = useToast();

  const poll = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      const res = await fetch("/api/operations", { cache: "no-store" });
      const data: OperationView[] = await res.json();

      let anyJustFinished = false;
      for (const op of data) {
        const prev = prevStages.current.get(op.id);
        if (prev && prev !== op.stage && op.isTerminal) {
          anyJustFinished = true;
          if (op.stage === "done") push("ok", `${op.label}: listo.`);
          else push("warn", `${op.label}: ${op.stageLabel}${op.note ? " — " + op.note : ""}`);
        }
      }
      prevStages.current = new Map(data.map((op) => [op.id, op.stage]));
      setOps(data);
      if (anyJustFinished) router.refresh();

      if (data.length > 0) {
        timerRef.current = setTimeout(poll, POLL_MS);
      }
    } catch {
      timerRef.current = setTimeout(poll, POLL_MS);
    }
  }, [push, router]);

  useEffect(() => {
    poll();
    const onStart = () => poll();
    window.addEventListener(OPERATION_STARTED_EVENT, onStart);
    return () => {
      window.removeEventListener(OPERATION_STARTED_EVENT, onStart);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [poll]);

  async function handleCancel(op: OperationView) {
    setCanceling((s) => new Set(s).add(op.id));
    try {
      const result = await cancelOperationAction(op.id);
      if (!result.ok) {
        push("warn", result.reason || `No se pudo cancelar "${op.label}".`);
      }
      router.refresh();
      poll();
    } finally {
      setCanceling((s) => {
        const next = new Set(s);
        next.delete(op.id);
        return next;
      });
    }
  }

  if (ops.length === 0) return null;

  return (
    <div className="fixed bottom-4 left-4 flex flex-col gap-2 z-40 w-72 max-w-[85vw]">
      {ops.map((op) => (
        <div key={op.id} className="border border-divider bg-bg shadow-md p-2.5 flex flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <span
              className={cx(
                "w-1.5 h-1.5 rounded-full",
                op.isTerminal ? "bg-text/30" : "bg-accent animate-op-pulse"
              )}
            />
            <span className="font-heading text-sm truncate flex-1">{op.label}</span>
            {!op.isTerminal && (
              <button
                type="button"
                onClick={() => handleCancel(op)}
                disabled={canceling.has(op.id)}
                className="text-xs text-text/50 hover:text-text underline bg-transparent border-none cursor-pointer p-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {canceling.has(op.id) ? "cancelando…" : "cancelar"}
              </button>
            )}
          </div>
          <span className="text-xs text-text/60">
            {op.progressLabel ? `${op.progressLabel} · ` : ""}
            {op.stageLabel}
          </span>
          {op.note && <span className="text-xs text-text/50">{op.note}</span>}
        </div>
      ))}
    </div>
  );
}
