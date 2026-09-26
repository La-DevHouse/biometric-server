"use client";

import { useEffect, useState } from "react";
import { previewImpactAction } from "@/app/admin/actions";
import type { ScopeChange, ImpactResult } from "@/lib/sync/impact";

const MAX_LISTED = 8;

/**
 * Aviso de impacto antes de guardar (docs/10 R8 / §6): "X pierde acceso a Y".
 * Se recalcula cuando cambia `change` (clave estable por JSON). `change = null`
 * = todavía no hay nada elegido. Solo lectura — no aplica nada.
 */
export function ImpactPreview({ change }: { change: ScopeChange | null }) {
  const key = change ? JSON.stringify(change) : null;
  const [state, setState] = useState<{ key: string; result: ImpactResult | { error: string } } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    previewImpactAction(JSON.parse(key) as ScopeChange).then((result) => {
      if (!cancelled) setState({ key, result });
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!key) return null;
  if (!state || state.key !== key) return <p className="m-0 text-xs text-text/60">Calculando impacto en los equipos…</p>;
  const r = state.result;
  if ("error" in r) return <p className="m-0 text-xs text-text/60">No se pudo calcular el impacto: {r.error}</p>;

  const removals = r.losses.filter((l) => l.devices.length > 0);
  const protectedOnly = r.losses.filter((l) => l.devices.length === 0 && l.protectedDevices.length > 0);
  if (removals.length === 0 && protectedOnly.length === 0 && r.frozenDevices.length === 0) {
    return (
      <p className="m-0 text-xs text-text/70">
        Nadie pierde acceso a ningún equipo{r.gains > 0 ? ` · ${r.gains} persona(s) ganan acceso a algún equipo` : ""}.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1 border border-accent2 p-2 text-xs">
      {removals.length > 0 && (
        <>
          <p className="m-0 font-semibold">
            ⚠ {removals.length} persona(s) pierden acceso — se las quitará de estos equipos:
          </p>
          <ul className="m-0 pl-4">
            {removals.slice(0, MAX_LISTED).map((l) => (
              <li key={l.employeeId}>
                {l.name} <span className="text-text/60">({l.cedula})</span>: {l.devices.join(", ")}
              </li>
            ))}
            {removals.length > MAX_LISTED && <li>… y {removals.length - MAX_LISTED} más.</li>}
          </ul>
        </>
      )}
      {protectedOnly.length > 0 && (
        <p className="m-0 text-text/70">
          {protectedOnly.length} admin(s) del equipo quedan fuera del alcance pero no se borran (nunca se tocan admins).
        </p>
      )}
      {r.frozenDevices.length > 0 && (
        <p className="m-0 text-text/70">
          Quedan sin sede activa (congelados — no se agrega ni se quita a nadie): {r.frozenDevices.join(", ")}.
        </p>
      )}
      {r.gains > 0 && <p className="m-0 text-text/70">{r.gains} persona(s) ganan acceso a algún equipo.</p>}
      <p className="m-0 text-text/60">
        Si son muchas bajas en un mismo equipo, se frenan y piden aprobación en la ficha del equipo.
      </p>
    </div>
  );
}
