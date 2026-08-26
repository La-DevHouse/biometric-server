"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { renameUserAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";

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
  const [state, formAction, isPending] = useActionState(renameUserAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push(state.warning ? "warn" : "ok", state.warning || "Renombrando — se verificará contra el equipo.");
      setOpen(false);
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  const truncated = name.trim().slice(0, 8);
  const willTruncate = name.trim().length > 8;

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Renombrar
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Renombrar usuario ${userId}`}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <input type="hidden" name="user_id" value={userId} />
          <label className="flex flex-col gap-1 text-xs text-text/70">
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
          <p className="text-xs text-text/50 m-0">
            {name.length}/8 caracteres que el equipo puede guardar
            {willTruncate && (
              <>
                {" "}
                — se guardará como <span className="font-mono text-text">&quot;{truncated}&quot;</span>
              </>
            )}
          </p>
          <Btn type="submit" variant="primary" disabled={isPending || !name.trim()}>
            {isPending ? "Encolando…" : "Renombrar y verificar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
