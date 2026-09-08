"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { deleteUserAction } from "@/app/admin/actions";

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
  const { formAction, startError, op, busy, reset } = useOperation(deleteUserAction);

  function close() {
    setOpen(false);
    setAck(false);
    reset();
  }

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Eliminar
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title={`Eliminar usuario ${userId}`}>
        <div className="flex flex-col gap-3">
          {!op && (
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
              {startError && <p className="text-sm m-0 text-text">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy || !ack}>
                {busy ? "Enviando…" : "Eliminar usuario"}
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
