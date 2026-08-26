"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { changePrivilegeAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";
import type { Privilege } from "@/lib/operations";

const OPTIONS: { value: Privilege; label: string }[] = [
  { value: "USER", label: "USER" },
  { value: "MANAGER", label: "MANAGER" },
  { value: "OPERATOR", label: "OPERATOR" },
  { value: "REGISTER", label: "REGISTER" },
];

// Verified against real hardware: only these two reliably apply. The other
// two return cmd_return_code:OK but the device silently keeps the old value.
const RELIABLE = new Set<Privilege>(["USER", "MANAGER"]);

export function ChangePrivilegeDialog({
  devId,
  userId,
  currentPrivilege,
}: {
  devId: string;
  userId: string;
  currentPrivilege: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [privilege, setPrivilege] = useState<Privilege>(
    (currentPrivilege as Privilege) || "USER"
  );
  const [state, formAction, isPending] = useActionState(changePrivilegeAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push(state.warning ? "warn" : "ok", state.warning || "Cambiando privilegio — se verificará contra el equipo.");
      setOpen(false);
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Privilegio
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Privilegio de usuario ${userId}`}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <input type="hidden" name="user_id" value={userId} />
          <input type="hidden" name="user_privilege" value={privilege} />
          <div className="flex flex-col gap-1.5">
            {OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="user_privilege_radio"
                  checked={privilege === opt.value}
                  onChange={() => setPrivilege(opt.value)}
                />
                {opt.label}
              </label>
            ))}
          </div>
          {!RELIABLE.has(privilege) && (
            <p className="text-xs text-text/50 m-0">
              Este firmware solo aplica MANAGER de forma fiable. El cambio se verificará contra el
              equipo y puede reportarse como no aplicado.
            </p>
          )}
          <Btn type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Encolando…" : "Cambiar y verificar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
