"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { deleteUserAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";

export function DeleteUserDialog({
  devId,
  userId,
  userName,
}: {
  devId: string;
  userId: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [state, formAction, isPending] = useActionState(deleteUserAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push(state.warning ? "warn" : "ok", state.warning || "Eliminando usuario del equipo.");
      setOpen(false);
      setAck(false);
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Eliminar
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Eliminar usuario ${userId}`}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <input type="hidden" name="user_id" value={userId} />
          <p className="text-sm m-0">
            Se eliminará a <strong>{userName || userId}</strong> del equipo, junto con sus huellas.
            Las marcaciones de asistencia ya registradas se conservan.
          </p>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Entiendo que esta acción no se puede deshacer
          </label>
          <Btn type="submit" variant="primary" disabled={isPending || !ack}>
            {isPending ? "Encolando…" : "Eliminar usuario"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
