"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { assignDeviceAction } from "@/app/admin/dispositivos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export function DeviceAssignDialog({
  devId,
  companies,
  sites,
  current,
}: {
  devId: string;
  companies: { id: number; name: string }[];
  sites: { id: number; name: string; company_id: number }[];
  current: { company_id: number | null; site_id: number | null; note: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [companyId, setCompanyId] = useState<number | "">(current.company_id ?? "");
  const [state, formAction, pending] = useActionState(assignDeviceAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  const visibleSites = sites.filter((s) => s.company_id === companyId);

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        {current.company_id == null ? "Asignar a empresa" : "Cambiar asignación"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Asignar dispositivo">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <p className="m-0 text-xs text-text/50">
            La empresa del dispositivo acota la lista de empleados al enrolar y agrupa sus marcajes.
          </p>

          <label className={LABEL}>
            Empresa
            <select
              name="company_id"
              className={INPUT}
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value === "" ? "" : Number(e.target.value))}
            >
              <option value="">— sin asignar —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className={LABEL}>
            Sede
            <select
              name="site_id"
              className={INPUT}
              defaultValue={current.site_id ?? ""}
              disabled={!companyId}
            >
              <option value="">— sin sede —</option>
              {visibleSites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className={LABEL}>
            Nota interna <span className="text-text/40">(admin del equipo del lado de la empresa, texto libre)</span>
            <input name="device_admin_note" className={INPUT} defaultValue={current.note ?? ""} />
          </label>

          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
