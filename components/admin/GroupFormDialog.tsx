"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createGroupAction, updateGroupAction } from "@/app/admin/grupos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface GroupValues {
  id: number;
  company_id: number;
  name: string;
  code: string | null;
  late_tolerance_min: number | null;
  early_leave_tolerance_min: number | null;
  absence_rule: "no_check_in" | "no_marks" | "under_hours" | null;
  absence_min_hours: number | null;
}

export function GroupFormDialog({
  group,
  companies,
}: {
  group?: GroupValues;
  companies: { id: number; name: string }[];
}) {
  const editing = !!group;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateGroupAction : createGroupAction,
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
        {editing ? "Editar" : "+ Nuevo grupo"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar grupo" : "Nuevo grupo de empleados"}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing && <input type="hidden" name="id" value={group.id} />}

          <label className={LABEL}>
            Empresa *
            {editing ? (
              <input
                className={INPUT}
                disabled
                value={companies.find((c) => c.id === group.company_id)?.name ?? "—"}
              />
            ) : (
              <select name="company_id" required className={INPUT} defaultValue="">
                <option value="" disabled>
                  — elegí una empresa —
                </option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </label>

          <label className={LABEL}>
            Nombre * <span className="text-text/40">(ej. Administrativo, Planta, Docentes)</span>
            <input name="name" required defaultValue={group?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código
            <input name="code" defaultValue={group?.code ?? ""} className={INPUT} />
          </label>

          <fieldset className="border border-divider p-2.5 flex flex-col gap-2">
            <legend className="text-[10px] uppercase tracking-widest text-text/50 px-1">
              Umbrales de asistencia (vacío = hereda de la empresa)
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <label className={LABEL}>
                Tolerancia tardanza (min)
                <input name="late_tolerance_min" type="number" min={0} defaultValue={group?.late_tolerance_min ?? ""} className={INPUT} />
              </label>
              <label className={LABEL}>
                Tolerancia salida antic. (min)
                <input name="early_leave_tolerance_min" type="number" min={0} defaultValue={group?.early_leave_tolerance_min ?? ""} className={INPUT} />
              </label>
              <label className={LABEL}>
                Regla de ausencia
                <select name="absence_rule" defaultValue={group?.absence_rule ?? ""} className={INPUT}>
                  <option value="">— sin definir —</option>
                  <option value="no_check_in">No marcó entrada</option>
                  <option value="no_marks">No marcó nada</option>
                  <option value="under_hours">Trabajó menos de X horas</option>
                </select>
              </label>
              <label className={LABEL}>
                Horas mínimas (si aplica)
                <input name="absence_min_hours" type="number" min={0} defaultValue={group?.absence_min_hours ?? ""} className={INPUT} />
              </label>
            </div>
          </fieldset>

          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear grupo"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
