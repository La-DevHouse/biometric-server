"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { createSiteAction, updateSiteAction } from "@/app/admin/empresas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface SiteFormValues {
  id: number;
  name: string;
  code: string | null;
}

export function SiteFormDialog({
  companyId,
  site,
}: {
  companyId: number;
  site?: SiteFormValues;
}) {
  const editing = !!site;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateSiteAction : createSiteAction,
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
      <Btn variant={editing ? "ghost" : "secondary"} onClick={() => setOpen(true)}>
        {editing ? "Editar" : "+ Sede"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? "Editar sede" : "Nueva sede"}>
        <form action={formAction} className="flex flex-col gap-3">
          {editing ? (
            <input type="hidden" name="id" value={site.id} />
          ) : (
            <input type="hidden" name="company_id" value={companyId} />
          )}
          <label className={LABEL}>
            Nombre *
            <input name="name" required defaultValue={site?.name ?? ""} className={INPUT} autoFocus />
          </label>
          <label className={LABEL}>
            Código
            <input name="code" defaultValue={site?.code ?? ""} className={INPUT} />
          </label>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear sede"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
