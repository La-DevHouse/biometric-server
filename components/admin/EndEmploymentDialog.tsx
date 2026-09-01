"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { endEmploymentAction } from "@/app/admin/empleados/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function EndEmploymentDialog({
  employmentId,
  companyName,
}: {
  employmentId: number;
  companyName: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(endEmploymentAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Baja registrada.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Dar de baja
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Dar de baja en ${companyName}`}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={employmentId} />
          <p className="m-0 text-xs text-text/50">
            El empleo queda cerrado con esta fecha. La persona sigue en el sistema (pool de
            reclutamiento) y su historial se conserva.
          </p>
          <label className="flex flex-col gap-1 text-xs text-text/70">
            Fecha de baja *
            <input name="end_date" type="date" required className={INPUT} autoFocus />
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : "Confirmar baja"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
