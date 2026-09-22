"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { endEmploymentAction } from "@/app/admin/empleados/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT } from "@/components/ui/fieldStyles";

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
      <IconBtn icon={Icon.power} label={`Dar de baja en ${companyName}`} tone="danger" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} title={`Dar de baja en ${companyName}`}>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="id" value={employmentId} />
          <p className="m-0 text-xs text-text/70">
            El empleo queda cerrado con esta fecha. La persona sigue en el sistema (pool de
            reclutamiento) y su historial se conserva.
          </p>
          <label className="flex flex-col gap-1 text-xs text-text/85">
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
