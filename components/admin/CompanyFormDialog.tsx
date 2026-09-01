"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createCompanyAction, updateCompanyAction } from "@/app/admin/empresas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface CompanyFormValues {
  id: number;
  name: string;
  tax_id: string | null;
  is_group: boolean;
  shared_employees: boolean;
  address: string | null;
  parent_id: number | null;
  late_tolerance_min: number | null;
  early_leave_tolerance_min: number | null;
  absence_rule: "no_check_in" | "no_marks" | "under_hours" | null;
  absence_min_hours: number | null;
}

export function CompanyFormDialog({
  company,
  parentOptions,
  trigger,
}: {
  company?: CompanyFormValues;
  parentOptions: { id: number; name: string }[];
  trigger?: "primary" | "ghost";
}) {
  const editing = !!company;
  const [open, setOpen] = useState(false);
  const [isGroup, setIsGroup] = useState(company?.is_group ?? false);
  const [state, formAction, pending] = useActionState(
    editing ? updateCompanyAction : createCompanyAction,
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

  // el padre no puede ser una empresa hija ni la empresa misma
  const options = parentOptions.filter((p) => p.id !== company?.id);

  return (
    <>
      <Btn variant={trigger ?? "primary"} onClick={() => setOpen(true)}>
        {editing ? "Editar" : "+ Nueva empresa"}
      </Btn>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar empresa" : "Nueva empresa cliente"}
      >
        <form action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={company.id} />}

          <label className={LABEL}>
            Razón social *
            <input name="name" required defaultValue={company?.name ?? ""} className={INPUT} autoFocus />
          </label>

          <label className="flex items-center gap-2 text-xs text-text/70">
            <input
              type="checkbox"
              name="is_group"
              defaultChecked={company?.is_group ?? false}
              onChange={(e) => setIsGroup(e.target.checked)}
            />
            Es un grupo (agrupa empresas hijas)
          </label>

          <label className={LABEL}>
            RIF {isGroup ? "(opcional para grupos)" : "*"}
            <input
              name="tax_id"
              required={!isGroup}
              defaultValue={company?.tax_id ?? ""}
              placeholder="J-123456789"
              className={INPUT}
            />
          </label>

          <label className={LABEL}>
            Empresa padre
            <select name="parent_id" defaultValue={company?.parent_id ?? ""} className={INPUT}>
              <option value="">— sin padre (nivel superior) —</option>
              {options.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-text/70">
            <input
              type="checkbox"
              name="shared_employees"
              defaultChecked={company?.shared_employees ?? false}
            />
            Empleados compartidos entre sedes/hijas del mismo grupo
          </label>

          <label className={LABEL}>
            Dirección
            <input name="address" defaultValue={company?.address ?? ""} className={INPUT} />
          </label>

          <fieldset className="border border-divider p-2.5 flex flex-col gap-2">
            <legend className="text-[10px] uppercase tracking-widest text-text/50 px-1">
              Umbrales de asistencia (opcional — heredan al grupo)
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Tolerancia tardanza (min)
                <input
                  name="late_tolerance_min"
                  type="number"
                  min={0}
                  defaultValue={company?.late_tolerance_min ?? ""}
                  className={INPUT}
                />
              </label>
              <label className={LABEL}>
                Tolerancia salida antic. (min)
                <input
                  name="early_leave_tolerance_min"
                  type="number"
                  min={0}
                  defaultValue={company?.early_leave_tolerance_min ?? ""}
                  className={INPUT}
                />
              </label>
              <label className={LABEL}>
                Regla de ausencia
                <select
                  name="absence_rule"
                  defaultValue={company?.absence_rule ?? ""}
                  className={INPUT}
                >
                  <option value="">— sin definir —</option>
                  <option value="no_check_in">No marcó entrada</option>
                  <option value="no_marks">No marcó nada</option>
                  <option value="under_hours">Trabajó menos de X horas</option>
                </select>
              </label>
              <label className={LABEL}>
                Horas mínimas (si aplica)
                <input
                  name="absence_min_hours"
                  type="number"
                  min={0}
                  defaultValue={company?.absence_min_hours ?? ""}
                  className={INPUT}
                />
              </label>
            </div>
          </fieldset>

          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "Crear empresa"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
