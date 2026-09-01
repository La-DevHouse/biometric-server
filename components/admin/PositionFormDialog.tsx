"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createPositionAction, updatePositionAction } from "@/app/admin/categorias/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface PositionValues {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  department_id: number | null;
}

export function PositionFormDialog({
  position,
  departments,
}: {
  position?: PositionValues;
  departments: { id: number; name: string }[];
}) {
  const editing = !!position;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updatePositionAction : createPositionAction,
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
        {editing ? "Editar" : "+ Puesto"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar puesto" : "Nuevo puesto"}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={position.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={position?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código
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
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
