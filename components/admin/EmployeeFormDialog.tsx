"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { DocumentField } from "./DocumentField";
import { splitDoc } from "@/lib/documento";
import { createEmployeeAction, updateEmployeeAction } from "@/app/admin/empleados/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface EmployeeValues {
  id: number;
  national_id: string;
  tax_id: string | null;
  first_name: string;
  last_name: string;
  birth_date: string | null; // YYYY-MM-DD
}

export function EmployeeFormDialog({ employee }: { employee?: EmployeeValues }) {
  const editing = !!employee;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateEmployeeAction : createEmployeeAction,
    ADMIN_ACTION_INITIAL
  );
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  const ced = splitDoc(employee?.national_id);
  const rif = splitDoc(employee?.tax_id);

  return (
    <>
      <Btn variant={editing ? "ghost" : "primary"} onClick={() => setOpen(true)}>
        {editing ? "Editar datos" : "+ Registrar persona"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar persona" : "Registrar persona"}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={employee.id} />}

          <DocumentField
            kind="cedula"
            label="Cédula"
            required
            prefixName="doc_prefix"
            numberName="doc_number"
            defaultPrefix={ced.prefix}
            defaultNumber={ced.number}
          />
          <DocumentField
            kind="rif"
            label="RIF"
            hint="(vacío = igual a la cédula)"
            prefixName="rif_prefix"
            numberName="rif_number"
            defaultPrefix={rif.prefix}
            defaultNumber={rif.number}
          />

          <div className="grid grid-cols-2 gap-2">
            <label className={LABEL}>
              Nombre *
              <input name="first_name" required defaultValue={employee?.first_name ?? ""} className={INPUT} />
            </label>
            <label className={LABEL}>
              Apellido *
              <input name="last_name" required defaultValue={employee?.last_name ?? ""} className={INPUT} />
            </label>
            <label className={LABEL}>
              Fecha de nacimiento
              <input name="birth_date" type="date" defaultValue={employee?.birth_date ?? ""} className={INPUT} />
            </label>
          </div>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Registrar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
