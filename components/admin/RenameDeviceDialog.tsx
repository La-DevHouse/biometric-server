"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { renameDeviceAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";

const INPUT_CLASS = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function RenameDeviceDialog({ devId, currentName }: { devId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(renameDeviceAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push("ok", "Renombrando — el nuevo nombre aparecerá cuando el equipo lo confirme.");
      setOpen(false);
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Renombrar
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Renombrar dispositivo">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <label className="flex flex-col gap-1 text-xs text-text/70">
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
          <p className="text-xs text-text/50 m-0">
            El nombre se actualiza cuando el equipo confirma el cambio en su próximo reporte
            (hasta ~10s) — no se muestra de forma optimista.
          </p>
          <Btn type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Encolando…" : "Renombrar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
