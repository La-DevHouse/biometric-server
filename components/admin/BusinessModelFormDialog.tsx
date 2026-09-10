"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import {
  createBusinessModelAction,
  updateBusinessModelAction,
} from "@/app/admin/categorias/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/85";

export interface BusinessModelValues {
  id: number;
  name: string;
  code: string | null;
}

export function BusinessModelFormDialog({ model }: { model?: BusinessModelValues }) {
  const editing = !!model;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateBusinessModelAction : createBusinessModelAction,
    ADMIN_ACTION_INITIAL
  );
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") {
      push("error", state.error);
    }
  }, [state, push]);

  return (
    <>
      <Btn variant={editing ? "ghost" : "primary"} onClick={() => setOpen(true)}>
        {editing ? "Editar" : "+ Modelo de negocio"}
      </Btn>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar modelo de negocio" : "Nuevo modelo de negocio"}
      >
        <form action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={model.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={model?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código <span className="text-text/60">(opcional — identificador corto de ALCO para reportes)</span>
            <input name="code" defaultValue={model?.code ?? ""} className={INPUT} />
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
