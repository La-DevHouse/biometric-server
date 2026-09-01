"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createAccountAction, updateAccountAction } from "@/app/admin/cuentas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

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
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      <Btn variant={editing ? "ghost" : "primary"} onClick={() => setOpen(true)}>
        {editing ? "Editar" : "+ Nueva cuenta"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar cuenta" : "Nueva cuenta"}>
        <form action={formAction} className="flex flex-col gap-3">
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
              Contraseña inicial * <span className="text-text/40">(mín. 8)</span>
              <input name="password" type="password" required minLength={8} className={INPUT} />
            </label>
          )}
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear cuenta"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
