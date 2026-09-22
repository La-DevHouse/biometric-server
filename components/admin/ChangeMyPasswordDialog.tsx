"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { changeMyPasswordAction } from "@/app/admin/cuentas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export function ChangeMyPasswordDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(changeMyPasswordAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Contraseña actualizada.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Cambiar mi contraseña
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Cambiar mi contraseña">
        <form action={formAction} className="flex flex-col gap-3">
          <p className="m-0 text-xs text-text/70">
            Se cierran tus otras sesiones abiertas; esta se mantiene.
          </p>
          <label className={LABEL}>
            Contraseña actual *
            <input name="current_password" type="password" required className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Contraseña nueva * <span className="text-text/60">(mín. 8)</span>
            <input name="new_password" type="password" required minLength={8} className={INPUT} />
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : "Actualizar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
