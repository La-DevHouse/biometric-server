"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import {
  createBusinessModelAction,
  updateBusinessModelAction,
} from "@/app/admin/categorias/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_OPTIONAL, FIELD_HINT } from "@/components/ui/fieldStyles";

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
  const onSubmit = useFormSubmit(formAction, state);
  const { push } = useToast();
  const formId = useId();

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
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar modelo de negocio" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Nuevo modelo de negocio" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar modelo de negocio" : "Nuevo modelo de negocio"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear"}
          </Btn>
        }
      >
        <form id={formId} onSubmit={onSubmit} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={model.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={model?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            <span>
              Código <span className={FIELD_OPTIONAL}>opcional</span>
            </span>
            <input name="code" defaultValue={model?.code ?? ""} className={INPUT} />
            <span className={FIELD_HINT}>Identificador corto de ALCO para reportes.</span>
          </label>
        </form>
      </Dialog>
    </>
  );
}
