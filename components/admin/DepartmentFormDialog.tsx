"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createDepartmentAction, updateDepartmentAction } from "@/app/admin/categorias/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface DepartmentValues {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
}

export function DepartmentFormDialog({ department }: { department?: DepartmentValues }) {
  const editing = !!department;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateDepartmentAction : createDepartmentAction,
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
        {editing ? "Editar" : "+ Departamento"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar departamento" : "Nuevo departamento"}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={department.id} />}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={department?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código
            <input name="code" defaultValue={department?.code ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Descripción
            <input name="description" defaultValue={department?.description ?? ""} className={INPUT} />
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
