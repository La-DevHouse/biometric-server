"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { viewBiometricsAction } from "@/app/admin/actions";

/**
 * Read-only: queues VIEW_BIOMETRICS (a GET_USER_INFO probe) and blocks until
 * it resolves, showing whatever note advance.ts left (backup numbers found)
 * — no fingerprint data is fetched or shown here.
 * (Migrating a fingerprint between devices IS possible — see "Capturar
 * huella" / "Copiar a otro equipo" on the employee page — but that's a
 * deliberate, verified action, not something this read-only probe does.)
 */
export function ViewBiometricsDialog({ devId, userId }: { devId: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const { formAction, startError, op, busy, reset } = useOperation(viewBiometricsAction);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Biométricos
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title={`Biométricos de usuario ${userId}`}>
        <div className="flex flex-col gap-3">
          {!op && (
            <>
              <p className="text-xs text-text/70 m-0">
                Las plantillas de huella son metadata de solo lectura — esto solo consulta al equipo
                qué huellas tiene registradas.
              </p>
              <form action={formAction}>
                <input type="hidden" name="dev_id" value={devId} />
                <input type="hidden" name="user_id" value={userId} />
                {startError && <p className="text-sm m-0 text-text mb-2">{startError}</p>}
                <Btn type="submit" variant="primary" disabled={busy}>
                  {busy ? "Consultando…" : "Consultar al equipo"}
                </Btn>
              </form>
            </>
          )}
          {op && !op.isTerminal && <OperationProgress op={op} />}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
