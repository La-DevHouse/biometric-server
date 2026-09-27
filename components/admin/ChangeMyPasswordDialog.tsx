"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import { changeMyPasswordAction } from "@/app/admin/cuentas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_HINT } from "@/components/ui/fieldStyles";

export function ChangeMyPasswordDialog() {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(changeMyPasswordAction, ADMIN_ACTION_INITIAL);
  const onSubmit = useFormSubmit(formAction, state);
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
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <p className="m-0 text-xs text-text/70">
            Se cierran tus otras sesiones abiertas; esta se mantiene.
          </p>
          <label className={LABEL}>
            Contraseña actual *
            <input name="current_password" type="password" required className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            <span>
              Contraseña nueva *
            </span>
            <input name="new_password" type="password" required minLength={8} className={INPUT} />
            <span className={FIELD_HINT}>Mínimo 8 caracteres.</span>
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : "Actualizar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
