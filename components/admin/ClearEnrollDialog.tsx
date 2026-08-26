"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { clearEnrollAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";

export function ClearEnrollDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [state, formAction, isPending] = useActionState(clearEnrollAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push(state.warning ? "warn" : "ok", state.warning || "Borrando biométricos del equipo.");
      setOpen(false);
      setAck(false);
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Borrar todos los biométricos…
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Borrar todos los biométricos">
        <div className="flex flex-col gap-3">
          <p className="text-sm m-0">
            Esto borra las huellas de <strong>todos</strong> los usuarios del equipo. Tendrán que
            re-enrolarse físicamente en el dispositivo — no hay forma de restaurarlas desde el
            servidor.
          </p>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Entiendo que esta acción no se puede deshacer
          </label>
          <form action={formAction}>
            <input type="hidden" name="dev_id" value={devId} />
            <Btn type="submit" variant="primary" disabled={isPending || !ack}>
              {isPending ? "Encolando…" : "Borrar biométricos"}
            </Btn>
          </form>
        </div>
      </Dialog>
    </>
  );
}
