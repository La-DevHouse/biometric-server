"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { syncLogsAction, clearLogsAction } from "@/app/admin/actions";

export function ClearLogsDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const sync = useOperation(syncLogsAction);
  const clear = useOperation(clearLogsAction);
  const busy = sync.busy || clear.busy;

  function close() {
    setOpen(false);
    setAck(false);
    sync.reset();
    clear.reset();
  }

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Borrar memoria de logs…
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title="Borrar memoria de logs">
        <div className="flex flex-col gap-3">
          <p className="text-sm m-0">
            Esto borra las marcaciones almacenadas en la memoria del equipo físico. El servidor
            conserva por separado todo lo ya sincronizado.
          </p>

          {!sync.op && (
            <form action={sync.formAction}>
              <input type="hidden" name="dev_id" value={devId} />
              {sync.startError && <p className="text-sm m-0 text-text mb-2">{sync.startError}</p>}
              <Btn type="submit" variant="secondary" disabled={busy}>
                {sync.busy ? "Enviando…" : "Sincronizar historial ahora →"}
              </Btn>
            </form>
          )}
          {sync.op && !sync.op.isTerminal && <OperationProgress op={sync.op} />}
          {sync.op?.isTerminal && <OperationResult op={sync.op} onClose={sync.reset} />}

          {!clear.op && (
            <>
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                Entiendo que las marcaciones no sincronizadas se perderán
              </label>
              <form action={clear.formAction}>
                <input type="hidden" name="dev_id" value={devId} />
                {clear.startError && <p className="text-sm m-0 text-text mb-2">{clear.startError}</p>}
                <Btn type="submit" variant="primary" disabled={busy || !ack}>
                  {clear.busy ? "Enviando…" : "Borrar memoria del equipo"}
                </Btn>
              </form>
            </>
          )}
          {clear.op && !clear.op.isTerminal && <OperationProgress op={clear.op} />}
          {clear.op?.isTerminal && <OperationResult op={clear.op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
