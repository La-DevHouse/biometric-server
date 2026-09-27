"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import { createAccountAction, updateAccountAction } from "@/app/admin/cuentas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_HINT } from "@/components/ui/fieldStyles";

export interface AccountValues {
  id: number;
  name: string;
  email: string;
}

export function AccountFormDialog({ account }: { account?: AccountValues }) {
  const editing = !!account;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateAccountAction : createAccountAction,
    ADMIN_ACTION_INITIAL
  );
  const onSubmit = useFormSubmit(formAction, state);
  const { push } = useToast();
  const formId = useId();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar cuenta" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Nueva cuenta" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar cuenta" : "Nueva cuenta"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear cuenta"}
          </Btn>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={account.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={account?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Email *
            <input name="email" type="email" required defaultValue={account?.email ?? ""} className={INPUT} />
          </label>
          {!editing && (
            <label className={LABEL}>
              <span>
                Contraseña inicial *
              </span>
              <input name="password" type="password" required minLength={8} className={INPUT} />
              <span className={FIELD_HINT}>Mínimo 8 caracteres.</span>
            </label>
          )}
        </form>
      </Dialog>
    </>
  );
}
