"use client";

import { useActionState, useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { createSiteAction, updateSiteAction } from "@/app/admin/empresas/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { COMMON_TIMEZONES, DEFAULT_TZ } from "@/lib/time";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export interface SiteFormValues {
  id: number;
  name: string;
  code: string | null;
  timezone: string;
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
  const formId = useId();

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
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar sede" onClick={() => setOpen(true)} />
      ) : (
        <IconBtn icon={Icon.add} label="Nueva sede" onClick={() => setOpen(true)} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar sede" : "Nueva sede"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear sede"}
          </Btn>
        }
      >
        <form id={formId} action={formAction} className="flex flex-col gap-3">
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
            Código <span className="text-text/60">(opcional — identificador corto de ALCO, único por empresa)</span>
            <input name="code" defaultValue={site?.code ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Zona horaria <span className="text-text/60">(hora local de la sede — marcajes y hora del equipo)</span>
            <select name="timezone" defaultValue={site?.timezone ?? DEFAULT_TZ} className={INPUT}>
              {site?.timezone && !(COMMON_TIMEZONES as readonly string[]).includes(site.timezone) && (
                <option value={site.timezone}>{site.timezone}</option>
              )}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </label>
        </form>
      </Dialog>
    </>
  );
}
