"use client";

import { useState } from "react";
import type { EmploymentLookups } from "@/lib/lookups";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export interface EmploymentDefaults {
  company_id?: number | null;
  schedule_group_id?: number | null;
  position_id?: number | null;
  department_id?: number | null;
  payroll_ref?: string | null;
  payroll_type?: "quincenal" | "semanal" | null;
  start_date?: string | null; // YYYY-MM-DD
}

/**
 * Campos de un contrato de trabajo: empresa + horario (filtrado por empresa,
 * client-side) + departamento/puesto + inicio + ref nómina. Reusado por alta de
 * contrato y por traslado. Los `name` son fijos (`company_id`, …). Sin sede: la
 * pertenencia es con la empresa, y el alcance de la huella sale de sus sedes
 * (y las de su grupo) — docs/10 R4.
 */
export function EmploymentFields({
  lookups,
  defaults,
  startLabel = "Fecha de inicio *",
  onCompanyChange,
}: {
  lookups: EmploymentLookups;
  defaults?: EmploymentDefaults;
  startLabel?: string;
  /** Para el aviso de impacto del traslado: avisa qué empresa se eligió. */
  onCompanyChange?: (companyId: number | null) => void;
}) {
  const [companyId, setCompanyId] = useState<number | "">(defaults?.company_id ?? "");
  const [positionSel, setPositionSel] = useState<string>(
    defaults?.position_id != null ? String(defaults.position_id) : ""
  );
  const schedules = lookups.schedules.filter((g) => g.company_id === companyId);

  // modelo de negocio de la empresa elegida → filtra los puestos
  const effectiveBm =
    companyId === "" ? null : lookups.companies.find((c) => c.id === companyId)?.business_model_id ?? null;
  const positions = lookups.positions.filter(
    (p) =>
      p.business_model_ids.length === 0 || // genérico
      (effectiveBm != null && p.business_model_ids.includes(effectiveBm))
  );

  return (
    <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
      <label className={LABEL}>
        Empresa *
        <select
          name="company_id"
          required
          className={INPUT}
          value={companyId}
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            setCompanyId(v);
            onCompanyChange?.(v === "" ? null : v);
          }}
        >
          <option value="" disabled>
            — elegí —
          </option>
          {lookups.companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        Horario
        <select
          name="schedule_group_id"
          className={INPUT}
          defaultValue={defaults?.schedule_group_id ?? ""}
          disabled={!companyId}
        >
          <option value="">— sin horario —</option>
          {schedules.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        Departamento
        <select name="department_id" className={INPUT} defaultValue={defaults?.department_id ?? ""}>
          <option value="">— sin departamento —</option>
          {lookups.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        Puesto
        <select
          name="position_id"
          className={INPUT}
          value={positionSel}
          onChange={(e) => setPositionSel(e.target.value)}
        >
          <option value="">— sin puesto —</option>
          {positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
          <option value="__new__">— otro: crear puesto nuevo —</option>
        </select>
      </label>

      <label className={LABEL}>
        Tipo de nómina
        <select name="payroll_type" className={INPUT} defaultValue={defaults?.payroll_type ?? ""}>
          <option value="">— sin nómina —</option>
          <option value="quincenal">Quincenal</option>
          <option value="semanal">Semanal</option>
        </select>
      </label>

      {positionSel === "__new__" && (
        <label className={`${LABEL} col-span-2`}>
          Nombre del puesto nuevo *
          <input name="new_position_name" className={INPUT} placeholder="ej. Cajero, Mesonero…" />
          <span className="text-xs text-text/60">
            Se crea en el catálogo{effectiveBm != null ? ", asociado al modelo de negocio de la empresa" : " como genérico"}.
          </span>
        </label>
      )}

      <label className={LABEL}>
        Ref. nómina
        <input name="payroll_ref" className={INPUT} defaultValue={defaults?.payroll_ref ?? ""} />
      </label>

      <label className={`${LABEL} col-span-2`}>
        {startLabel}
        <input name="start_date" type="date" required className={INPUT} defaultValue={defaults?.start_date ?? ""} />
      </label>
    </div>
  );
}
