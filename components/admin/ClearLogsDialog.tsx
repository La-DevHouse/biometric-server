"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useOperation } from "./useOperation";
import { syncLogsAction, clearLogsAction } from "@/app/admin/actions";

export function ClearLogsDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  // Sincronizar NO cierra el diálogo: es el paso previo opcional a borrar, y
  // su avance se ve en el panel "Procesando" mientras tanto. Borrar sí lo cierra.
  const [syncQueued, setSyncQueued] = useState(false);
  const sync = useOperation(syncLogsAction, { onStarted: () => setSyncQueued(true) });
  const clear = useOperation(clearLogsAction, { onStarted: close });
  const busy = sync.busy || clear.busy;

  function close() {
    setOpen(false);
    setAck(false);
    setSyncQueued(false);
  }

  return (
    <>
      <IconBtn icon={Icon.trash} label="Borrar memoria de logs…" tone="danger" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={close} closable={!busy} title="Borrar memoria de logs">
        <div className="flex flex-col gap-3">
          <p className="text-sm m-0">
            Esto borra las marcaciones almacenadas en la memoria del equipo físico. El servidor
            conserva por separado todo lo ya sincronizado.
          </p>

          {syncQueued ? (
            <p className="text-sm m-0 text-accent">
              Sincronización en cola — seguila en el panel “Procesando” antes de borrar.
            </p>
          ) : (
            <form action={sync.formAction}>
              <input type="hidden" name="dev_id" value={devId} />
              {sync.startError && <p className="text-sm m-0 text-text mb-2">{sync.startError}</p>}
              <Btn type="submit" variant="secondary" disabled={busy}>
                {sync.busy ? "Enviando…" : "Sincronizar historial ahora →"}
              </Btn>
            </form>
          )}

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
        </div>
      </Dialog>
    </>
  );
}
