"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { EmploymentFields } from "./EmploymentFields";
import { createEmploymentAction, transferEmployeeAction } from "@/app/admin/empleados/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import type { EmploymentLookups } from "@/lib/lookups";

/**
 * Dos modos:
 *  - alta de empleo (mode "create"): crea un employment nuevo para la persona.
 *  - traslado (mode "transfer"): cierra `fromEmploymentId` y abre uno nuevo en la
 *    empresa destino, con la fecha de inicio como fecha del traslado.
 */
export function EmploymentFormDialog({
  employeeId,
  lookups,
  mode,
  fromEmploymentId,
  triggerLabel,
}: {
  employeeId: number;
  lookups: EmploymentLookups;
  mode: "create" | "transfer";
  fromEmploymentId?: number;
  triggerLabel?: string;
}) {
  const isTransfer = mode === "transfer";
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    isTransfer ? transferEmployeeAction : createEmploymentAction,
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
      <Btn variant={isTransfer ? "secondary" : "primary"} onClick={() => setOpen(true)}>
        {triggerLabel ?? (isTransfer ? "Trasladar" : "+ Nuevo empleo")}
      </Btn>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={isTransfer ? "Trasladar a otra empresa" : "Nuevo empleo"}
      >
        <form action={formAction} className="flex flex-col gap-3">
          {isTransfer ? (
            <input type="hidden" name="from_employment_id" value={fromEmploymentId} />
          ) : (
            <input type="hidden" name="employee_id" value={employeeId} />
          )}
          {isTransfer && (
            <p className="m-0 text-xs text-text/50">
              Cierra el empleo actual con esta fecha y abre uno nuevo en la empresa destino,
              conservando el historial de la persona.
            </p>
          )}
          <EmploymentFields
            lookups={lookups}
            startLabel={isTransfer ? "Fecha del traslado *" : "Fecha de inicio *"}
          />
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : isTransfer ? "Confirmar traslado" : "Registrar empleo"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
