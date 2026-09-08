"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { renameDeviceAction } from "@/app/admin/actions";

const INPUT_CLASS = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function RenameDeviceDialog({ devId, currentName }: { devId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const { formAction, startError, op, busy, reset } = useOperation(renameDeviceAction);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Renombrar
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title="Renombrar dispositivo">
        <div className="flex flex-col gap-3">
          {!op && (
            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="dev_id" value={devId} />
              <label className="flex flex-col gap-1 text-xs text-text/85">
                Nombre nuevo
                <input
                  type="text"
                  name="fk_name"
                  required
                  defaultValue={currentName}
                  className={INPUT_CLASS}
                  autoFocus
                />
              </label>
              <p className="text-xs text-text/70 m-0">
                El nombre se actualiza cuando el equipo confirma el cambio en su próximo reporte
                (hasta ~10s) — no se muestra de forma optimista.
              </p>
              {startError && <p className="text-sm m-0 text-text">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy}>
                {busy ? "Enviando…" : "Renombrar"}
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
