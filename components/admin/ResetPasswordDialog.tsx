"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { resetPasswordAction } from "@/app/admin/cuentas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function ResetPasswordDialog({ id, name }: { id: number; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(resetPasswordAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Contraseña restablecida.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Resetear contraseña
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Resetear contraseña — ${name}`}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={id} />
          <p className="m-0 text-xs text-text/50">
            Se cierran todas las sesiones abiertas de esta cuenta. La persona deberá entrar con la
            contraseña nueva.
          </p>
          <label className="flex flex-col gap-1 text-xs text-text/70">
            Contraseña nueva * <span className="text-text/40">(mín. 8)</span>
            <input name="password" type="password" required minLength={8} className={INPUT} autoFocus />
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : "Restablecer"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
