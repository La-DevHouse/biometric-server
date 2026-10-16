"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import { assignDeviceToSiteAction } from "@/app/admin/dispositivos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_LABEL as LABEL, FIELD_HINT } from "@/components/ui/fieldStyles";
import { ImpactPreview } from "./ImpactPreview";

export interface SiteDeviceOption {
  dev_id: string;
  label: string;
  site_id: number | null;
  /** "Empresa · Sede" donde está hoy, o null si está pendiente de asignar. */
  where: string | null;
}

/**
 * Asignar un equipo a esta sede desde Empresa → Sedes, sin ir al equipo. Mismo
 * efecto que Equipos → Asignar (assignDeviceToSiteAction): si estaba en otra sede
 * se mueve, y el reconciliador lo sincroniza con el alcance de esta (docs/10 §4.3).
 */
export function SiteDevicesDialog({
  site,
  devices,
}: {
  site: { id: number; name: string; active: boolean };
  devices: SiteDeviceOption[];
}) {
  const [open, setOpen] = useState(false);
  const [devId, setDevId] = useState("");
  const [state, formAction, pending] = useActionState(assignDeviceToSiteAction, ADMIN_ACTION_INITIAL);
  const onSubmit = useFormSubmit(formAction, state);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setDevId("");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  const here = devices.filter((d) => d.site_id === site.id);
  const others = devices.filter((d) => d.site_id !== site.id);
  const picked = others.find((d) => d.dev_id === devId) ?? null;

  if (!site.active) return null;

  return (
    <>
      <IconBtn icon={Icon.addDevice} label="Asignar equipo" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} closable={!pending} title={`Equipos de ${site.name}`}>
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input type="hidden" name="site_id" value={site.id} />
          <input type="hidden" name="dev_id" value={devId} />

          <div className="flex flex-col gap-1">
            <span className={LABEL}>En esta sede</span>
            {here.length === 0 ? (
              <span className="text-sm text-text/70">Ningún equipo todavía.</span>
            ) : (
              <ul className="m-0 list-none p-0 text-sm">
                {here.map((d) => (
                  <li key={d.dev_id}>
                    {d.label} <span className="font-mono text-xs text-text/60">{d.dev_id}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className={LABEL}>
            Asignar equipo
            <Combobox
              ariaLabel="Equipo"
              options={others.map((d) => ({
                value: d.dev_id,
                label: d.label === d.dev_id ? d.dev_id : `${d.label} (${d.dev_id})`,
                hint: d.where ?? "pendiente de asignar",
              }))}
              value={devId}
              onChange={setDevId}
              placeholder="Buscar por nombre o serie…"
              disabled={pending}
            />
            <span className={FIELD_HINT}>
              Define quién se enrola en el equipo: los empleados con contrato en esta empresa (y en su grupo, si
              comparte empleados).
            </span>
          </div>

          {picked?.where && (
            <p className="m-0 text-xs text-text">
              Este equipo está hoy en <strong>{picked.where}</strong>: se mueve a {site.name}. Sus marcaciones viejas
              pasan a contar para esta empresa.
            </p>
          )}

          {open && picked && <ImpactPreview change={{ kind: "device_site", devId: picked.dev_id, siteId: site.id }} />}

          <Btn type="submit" variant="primary" disabled={pending || !picked}>
            {pending ? "Guardando…" : "Asignar a esta sede"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
