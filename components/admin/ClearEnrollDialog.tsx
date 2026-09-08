"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { clearEnrollAction } from "@/app/admin/actions";

export function ClearEnrollDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const { formAction, startError, op, busy, reset } = useOperation(clearEnrollAction);

  function close() {
    setOpen(false);
    setAck(false);
    reset();
  }

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Borrar todos los biométricos…
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title="Borrar todos los biométricos">
        <div className="flex flex-col gap-3">
          {!op && (
            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="dev_id" value={devId} />
              <p className="text-sm m-0">
                Esto borra las huellas de <strong>todos</strong> los usuarios del equipo. Tendrán que
                re-enrolarse físicamente en el dispositivo — no hay forma de restaurarlas desde el
                servidor.
              </p>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                Entiendo que esta acción no se puede deshacer
              </label>
              {startError && <p className="text-sm m-0 text-text">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy || !ack}>
                {busy ? "Enviando…" : "Borrar biométricos"}
              </Btn>
            </form>
          )}
          {op && !op.isTerminal && <OperationProgress op={op} />}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
