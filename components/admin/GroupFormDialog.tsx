"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { Collapsible } from "@/components/ui/Collapsible";
import { useToast } from "./Toaster";
import { createGroupAction, updateGroupAction } from "@/app/admin/grupos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

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
  const formId = useId();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar grupo" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Nuevo grupo" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar grupo" : "Nuevo grupo de empleados"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear grupo"}
          </Btn>
        }
      >
        <form id={formId} action={formAction} className="flex flex-col gap-3">
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
            Nombre * <span className="text-text/60">(ej. Administrativo, Planta, Docentes)</span>
            <input name="name" required defaultValue={group?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código <span className="text-text/60">(opcional — identificador corto de ALCO para reportes)</span>
            <input name="code" defaultValue={group?.code ?? ""} className={INPUT} />
          </label>

          <Collapsible title="Umbrales de asistencia (vacío = hereda de la empresa)">
            <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
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
          </Collapsible>
        </form>
      </Dialog>
    </>
  );
}
