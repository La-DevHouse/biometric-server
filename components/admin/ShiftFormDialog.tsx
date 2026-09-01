"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createShiftAction, updateShiftAction } from "@/app/admin/grupos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";
const DAYS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
  [7, "Dom"],
] as const;

export interface ShiftValues {
  id: number;
  code: string | null;
  name: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  hours: string | null;
  variable_in_out: boolean;
  crosses_midnight: boolean;
  workdays: number[];
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null;
}

export function ShiftFormDialog({
  groupId,
  shift,
}: {
  groupId: number;
  shift?: ShiftValues;
}) {
  const editing = !!shift;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateShiftAction : createShiftAction,
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
        {editing ? "Editar" : "+ Turno"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar turno" : "Nuevo turno"}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing ? (
            <input type="hidden" name="id" value={shift.id} />
          ) : (
            <input type="hidden" name="employee_group_id" value={groupId} />
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className={LABEL}>
              Nombre *
              <input name="name" required defaultValue={shift?.name ?? ""} className={INPUT} autoFocus />
            </label>
            <label className={LABEL}>
              Código
              <input name="code" defaultValue={shift?.code ?? ""} className={INPUT} placeholder="8/12-2/6" />
            </label>
            <label className={LABEL}>
              Hora inicio * <span className="text-text/40">HH:MM</span>
              <input name="start_time" required defaultValue={shift?.start_time ?? ""} className={INPUT} placeholder="06:30" />
            </label>
            <label className={LABEL}>
              Hora fin *
              <input name="end_time" required defaultValue={shift?.end_time ?? ""} className={INPUT} placeholder="13:30" />
            </label>
            <label className={LABEL}>
              Inicio descanso
              <input name="break_start" defaultValue={shift?.break_start ?? ""} className={INPUT} placeholder="12:00" />
            </label>
            <label className={LABEL}>
              Fin descanso
              <input name="break_end" defaultValue={shift?.break_end ?? ""} className={INPUT} placeholder="13:00" />
            </label>
            <label className={LABEL}>
              Horas de jornada
              <input name="hours" type="number" step="0.25" min={0} defaultValue={shift?.hours ?? ""} className={INPUT} placeholder="6.00" />
            </label>
            <label className={LABEL}>
              Vigencia desde *
              <input name="effective_from" type="date" required defaultValue={shift?.effective_from ?? ""} className={INPUT} />
            </label>
            <label className={LABEL}>
              Vigencia hasta
              <input name="effective_to" type="date" defaultValue={shift?.effective_to ?? ""} className={INPUT} />
            </label>
          </div>

          <div className="flex flex-col gap-1 text-xs text-text/70">
            Días de trabajo
            <div className="flex flex-wrap gap-2">
              {DAYS.map(([n, lbl]) => (
                <label key={n} className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="workdays"
                    value={n}
                    defaultChecked={shift ? shift.workdays.includes(n) : n >= 1 && n <= 5}
                  />
                  {lbl}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-text/70">
            <input type="checkbox" name="variable_in_out" defaultChecked={shift?.variable_in_out ?? false} />
            Entrada y salida variable
          </label>
          <label className="flex items-center gap-2 text-xs text-text/70">
            <input type="checkbox" name="crosses_midnight" defaultChecked={shift?.crosses_midnight ?? false} />
            El turno cruza la medianoche (termina al día siguiente)
          </label>

          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear turno"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
