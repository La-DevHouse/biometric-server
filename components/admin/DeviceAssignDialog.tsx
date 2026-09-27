"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "./Toaster";
import { assignDeviceAction } from "@/app/admin/dispositivos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import { ImpactPreview } from "./ImpactPreview";

/**
 * Asigna el equipo a una sede (docs/10 R3). Primero la empresa (combobox con
 * búsqueda por nombre o RIF, docs/11 E5) y después una de sus sedes activas:
 * la empresa sale de la sede. Sin sede = "pendiente de asignar" (congelado).
 */
export function DeviceAssignDialog({
  devId,
  sites,
  current,
}: {
  devId: string;
  sites: { id: number; name: string; company_id: number; company_name: string; company_tax_id?: string | null }[];
  current: { site_id: number | null; note: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState<number | null>(current.site_id);
  const [companyId, setCompanyId] = useState<number | null>(
    sites.find((s) => s.id === current.site_id)?.company_id ?? null
  );
  const [state, formAction, pending] = useActionState(assignDeviceAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  // key = id: dos empresas pueden llamarse igual (docs/11 U7)
  const byCompany = new Map<number, { id: number; name: string; taxId: string | null; sites: typeof sites }>();
  for (const s of sites) {
    const entry = byCompany.get(s.company_id) ?? {
      id: s.company_id,
      name: s.company_name,
      taxId: s.company_tax_id ?? null,
      sites: [],
    };
    entry.sites.push(s);
    byCompany.set(s.company_id, entry);
  }
  const companySites = companyId != null ? (byCompany.get(companyId)?.sites ?? []) : [];

  function pickCompany(v: string) {
    const id = v === "" ? null : Number(v);
    setCompanyId(id);
    const own = id != null ? (byCompany.get(id)?.sites ?? []) : [];
    // Con una sola sede no hay nada que elegir.
    setSiteId(own.length === 1 ? own[0].id : null);
  }

  return (
    <>
      <IconBtn
        icon={Icon.assign}
        label={current.site_id == null ? "Asignar a sede" : "Cambiar sede"}
        onClick={() => setOpen(true)}
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="Asignar equipo">
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <p className="m-0 text-xs text-text/70">
            El equipo pertenece a una sede, y por ella a una empresa. Define quién se enrola en él:
            los empleados con contrato en esa empresa (y en su grupo, si comparte empleados).
          </p>

          <div className={LABEL}>
            Empresa
            <Combobox
              ariaLabel="Empresa"
              options={[...byCompany.values()].map((c) => ({
                value: String(c.id),
                label: c.name,
                hint: c.taxId ?? undefined,
              }))}
              emptyLabel="— pendiente de asignar —"
              value={companyId == null ? "" : String(companyId)}
              onChange={pickCompany}
              placeholder="Buscar empresa o RIF…"
            />
          </div>

          <label className={LABEL}>
            Sede
            <select
              name="site_id"
              className={INPUT}
              value={siteId ?? ""}
              disabled={companyId == null}
              required={companyId != null}
              onChange={(e) => setSiteId(e.target.value === "" ? null : Number(e.target.value))}
            >
              <option value="">{companyId == null ? "— pendiente de asignar —" : "Elegí una sede…"}</option>
              {companySites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
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
