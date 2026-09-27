"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { EmploymentFields, type EmploymentDefaults } from "./EmploymentFields";
import { createEmploymentAction, updateEmploymentAction } from "@/app/admin/empleados/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import type { EmploymentLookups } from "@/lib/lookups";
import { ImpactPreview } from "./ImpactPreview";

export interface EditableEmployment extends EmploymentDefaults {
  id: number;
  company_id: number;
  company_name: string;
  start_date: string; // YYYY-MM-DD
}

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Contrato de trabajo (docs/11 P2), dos modos:
 *  - "create": alta de un contrato nuevo para la persona.
 *  - "edit": el mismo formulario precargado, sobre la MISMA fila. La empresa no
 *    se edita: para pasar a otra empresa se da de baja y se crea uno nuevo.
 * Reemplaza al viejo "Trasladar".
 */
export function EmploymentFormDialog({
  employeeId,
  lookups,
  mode,
  employment,
  variant = "icon",
}: {
  employeeId: number;
  lookups: EmploymentLookups;
  mode: "create" | "edit";
  /** Obligatorio en "edit". */
  employment?: EditableEmployment;
  /** "button": botón con texto (acción principal de un estado vacío, U2). */
  variant?: "icon" | "button";
}) {
  const editing = mode === "edit" && employment != null;
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(employment?.start_date ?? "");
  const [state, formAction, pending] = useActionState(
    editing ? updateEmploymentAction : createEmploymentAction,
    ADMIN_ACTION_INITIAL
  );
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  const title = editing ? `Editar contrato — ${employment.company_name}` : "Nuevo contrato";
  // Mover el inicio al futuro saca a la persona del alcance de hoy (deja de ser vigente).
  const today = todayYmd();
  const leavesScope = editing && employment.start_date <= today && startDate > today;

  return (
    <>
      {variant === "button" ? (
        <Btn variant="primary" onClick={() => setOpen(true)}>
          + Nuevo contrato
        </Btn>
      ) : (
        <IconBtn icon={editing ? Icon.edit : Icon.add} label={editing ? "Editar contrato" : "Nuevo contrato"} onClick={() => setOpen(true)} />
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing ? (
            <input type="hidden" name="id" value={employment.id} />
          ) : (
            <input type="hidden" name="employee_id" value={employeeId} />
          )}
          {editing && (
            <p className="m-0 text-xs text-text/70">
              La empresa no se cambia: para pasar a la persona a otra empresa, dale de baja este contrato y registrale uno
              nuevo — así queda el historial.
            </p>
          )}
          <EmploymentFields
            lookups={lookups}
            defaults={employment}
            lockCompany={editing ? { id: employment.company_id, name: employment.company_name } : undefined}
            onStartDateChange={setStartDate}
          />
          {open && leavesScope && <ImpactPreview change={{ kind: "end_contract", employmentId: employment.id }} />}
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar cambios" : "Registrar contrato"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
