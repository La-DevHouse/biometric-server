"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { syncLogsAction, clearLogsAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";

export function ClearLogsDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [syncState, syncAction, syncPending] = useActionState(syncLogsAction, OP_ACTION_INITIAL);
  const [clearState, clearAction, clearPending] = useActionState(clearLogsAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (syncState.status === "ok") {
      notifyOperationStarted();
      push("ok", "Sincronizando historial antes de borrar…");
    } else if (syncState.status === "error") {
      push("error", syncState.message);
    }
  }, [syncState, push]);

  useEffect(() => {
    if (clearState.status === "ok") {
      notifyOperationStarted();
      push(clearState.warning ? "warn" : "ok", clearState.warning || "Borrando memoria de logs del equipo.");
      setOpen(false);
      setAck(false);
    } else if (clearState.status === "error") {
      push("error", clearState.message);
    }
  }, [clearState, push]);

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Borrar memoria de logs…
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Borrar memoria de logs">
        <div className="flex flex-col gap-3">
          <p className="text-sm m-0">
            Esto borra las marcaciones almacenadas en la memoria del equipo físico. El servidor
            conserva por separado todo lo ya sincronizado.
          </p>
          <form action={syncAction}>
            <input type="hidden" name="dev_id" value={devId} />
            <Btn type="submit" variant="secondary" disabled={syncPending}>
              {syncPending ? "Encolando…" : "Sincronizar historial ahora →"}
            </Btn>
          </form>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Entiendo que las marcaciones no sincronizadas se perderán
          </label>
          <form action={clearAction}>
            <input type="hidden" name="dev_id" value={devId} />
            <Btn type="submit" variant="primary" disabled={clearPending || !ack}>
              {clearPending ? "Encolando…" : "Borrar memoria del equipo"}
            </Btn>
          </form>
        </div>
      </Dialog>
    </>
  );
}
