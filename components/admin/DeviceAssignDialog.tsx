"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { assignDeviceAction } from "@/app/admin/dispositivos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import { ImpactPreview } from "./ImpactPreview";

/**
 * Asigna el equipo a una sede (docs/10 R3). Un solo selector con las sedes
 * activas agrupadas por empresa: la empresa sale de la sede. Sin sede =
 * "pendiente de asignar".
 */
export function DeviceAssignDialog({
  devId,
  sites,
  current,
}: {
  devId: string;
  sites: { id: number; name: string; company_id: number; company_name: string }[];
  current: { site_id: number | null; note: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState<number | null>(current.site_id);
  const [state, formAction, pending] = useActionState(assignDeviceAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  const byCompany = new Map<number, { name: string; sites: typeof sites }>();
  for (const s of sites) {
    const entry = byCompany.get(s.company_id) ?? { name: s.company_name, sites: [] };
    entry.sites.push(s);
    byCompany.set(s.company_id, entry);
  }

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        {current.site_id == null ? "Asignar a sede" : "Cambiar sede"}
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Asignar dispositivo">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <p className="m-0 text-xs text-text/70">
            El equipo pertenece a una sede, y por ella a una empresa. Define quién se enrola en él:
            los empleados con contrato en esa empresa (y en su grupo, si comparte empleados).
          </p>

          <label className={LABEL}>
            Sede
            <select
              name="site_id"
              className={INPUT}
              value={siteId ?? ""}
              onChange={(e) => setSiteId(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">— pendiente de asignar —</option>
              {[...byCompany.values()].map((c) => (
                <optgroup key={c.name} label={c.name}>
                  {c.sites.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {open && siteId !== current.site_id && (
            <ImpactPreview change={{ kind: "device_site", devId, siteId }} />
          )}

          <label className={LABEL}>
            Nota interna <span className="text-text/60">(admin del equipo del lado de la empresa, texto libre)</span>
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
