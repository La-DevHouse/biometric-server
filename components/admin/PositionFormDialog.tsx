"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { createPositionAction, updatePositionAction } from "@/app/admin/categorias/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export interface PositionValues {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  department_id: number | null;
  business_model_ids: number[];
}

export function PositionFormDialog({
  position,
  departments,
  businessModels,
}: {
  position?: PositionValues;
  departments: { id: number; name: string }[];
  businessModels: { id: number; name: string }[];
}) {
  const editing = !!position;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updatePositionAction : createPositionAction,
    ADMIN_ACTION_INITIAL
  );
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
        <IconBtn icon={Icon.edit} label="Editar puesto" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Nuevo puesto" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar puesto" : "Nuevo puesto"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear"}
          </Btn>
        }
      >
        <form id={formId} action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={position.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={position?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código <span className="text-text/60">(opcional — identificador corto de ALCO para reportes)</span>
            <input name="code" defaultValue={position?.code ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Departamento
            <select name="department_id" defaultValue={position?.department_id ?? ""} className={INPUT}>
              <option value="">— sin departamento —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            Descripción
            <input name="description" defaultValue={position?.description ?? ""} className={INPUT} />
          </label>
          <fieldset className="border border-divider p-2.5 flex flex-col gap-1.5">
            <legend className="text-xs uppercase tracking-widest text-text/70 px-1">
              Modelos de negocio
            </legend>
            <p className="m-0 text-xs text-text/60">
              Sin marcar ninguno = cargo genérico (aparece en todos los modelos).
            </p>
            {businessModels.length === 0 ? (
              <p className="m-0 text-xs text-text/60">
                No hay modelos de negocio cargados todavía.
              </p>
            ) : (
              <div className="flex flex-col sm:grid sm:grid-cols-2 gap-1">
                {businessModels.map((bm) => (
                  <label key={bm.id} className="flex items-center gap-2 text-xs text-text/85">
                    <input
                      type="checkbox"
                      name="business_model_ids"
                      value={bm.id}
                      defaultChecked={position?.business_model_ids.includes(bm.id) ?? false}
                    />
                    {bm.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </form>
      </Dialog>
    </>
  );
}
