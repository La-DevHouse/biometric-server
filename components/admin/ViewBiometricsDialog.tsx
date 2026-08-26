"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { viewBiometricsAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";
import type { OperationView } from "@/lib/operations";

/**
 * Read-only: queues VIEW_BIOMETRICS (a GET_USER_INFO probe) and polls its
 * own operation until terminal, showing whatever note advance.ts left
 * (backup numbers found) — no fingerprint data is ever fetched or shown,
 * per the "biometrics are read-only metadata, never cloned" rule.
 */
export function ViewBiometricsDialog({ devId, userId }: { devId: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const [op, setOp] = useState<OperationView | null>(null);
  const [state, formAction, isPending] = useActionState(viewBiometricsAction, OP_ACTION_INITIAL);
  const { push } = useToast();
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.status === "error") push("error", state.message);
    if (state.status === "ok") {
      notifyOperationStarted();
      const poll = async (id: number) => {
        const res = await fetch(`/api/operations/${id}`, { cache: "no-store" });
        if (!res.ok) return;
        const data: OperationView = await res.json();
        setOp(data);
        if (!data.isTerminal) pollRef.current = setTimeout(() => poll(id), 2000);
      };
      poll(state.id);
    }
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Biométricos
      </Btn>
      <Dialog
        open={open}
        onClose={() => {
          setOpen(false);
          setOp(null);
          if (pollRef.current) clearTimeout(pollRef.current);
        }}
        title={`Biométricos de usuario ${userId}`}
      >
        <div className="flex flex-col gap-3">
          <p className="text-xs text-text/50 m-0">
            Las plantillas de huella son metadata de solo lectura — no se pueden copiar entre
            equipos, así que esto solo consulta al equipo qué huellas tiene registradas.
          </p>
          {!op && (
            <form action={formAction}>
              <input type="hidden" name="dev_id" value={devId} />
              <input type="hidden" name="user_id" value={userId} />
              <Btn type="submit" variant="primary" disabled={isPending}>
                {isPending ? "Consultando…" : "Consultar al equipo"}
              </Btn>
            </form>
          )}
          {op && !op.isTerminal && (
            <p className="text-sm text-text/70 m-0">{op.stageLabel}…</p>
          )}
          {op?.isTerminal && (
            <p className="text-sm m-0">
              {op.stage === "done"
                ? op.note || "El equipo no reportó detalle de huellas."
                : `${op.stageLabel}${op.note ? " — " + op.note : ""}`}
            </p>
          )}
        </div>
      </Dialog>
    </>
  );
}
