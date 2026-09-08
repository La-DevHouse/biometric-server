"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { renameUserAction } from "@/app/admin/actions";

const INPUT_CLASS = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function RenameUserDialog({
  devId,
  userId,
  currentName,
}: {
  devId: string;
  userId: string;
  currentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(currentName);
  const { formAction, startError, op, busy, reset } = useOperation(renameUserAction);

  function close() {
    setOpen(false);
    reset();
  }

  const truncated = name.trim().slice(0, 8);
  const willTruncate = name.trim().length > 8;

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Renombrar
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title={`Renombrar usuario ${userId}`}>
        <div className="flex flex-col gap-3">
          {!op && (
            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="dev_id" value={devId} />
              <input type="hidden" name="user_id" value={userId} />
              <label className="flex flex-col gap-1 text-xs text-text/85">
                Nombre nuevo
                <input
                  type="text"
                  name="user_name"
                  className={INPUT_CLASS}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              <p className="text-xs text-text/70 m-0">
                {name.length}/8 caracteres que el equipo puede guardar
                {willTruncate && (
                  <>
                    {" "}
                    — se guardará como <span className="font-mono text-text">&quot;{truncated}&quot;</span>
                  </>
                )}
              </p>
              {startError && <p className="text-sm m-0 text-text">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy || !name.trim()}>
                {busy ? "Enviando…" : "Renombrar y verificar"}
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
