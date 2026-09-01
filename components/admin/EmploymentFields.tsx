"use client";

import { useState } from "react";
import type { EmploymentLookups } from "@/lib/lookups";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";
const LABEL = "flex flex-col gap-1 text-xs text-text/70";

export interface EmploymentDefaults {
  company_id?: number | null;
  site_id?: number | null;
  employee_group_id?: number | null;
  position_id?: number | null;
  department_id?: number | null;
  payroll_ref?: string | null;
  start_date?: string | null; // YYYY-MM-DD
}

/**
 * Campos de un empleo: empresa + sede/grupo (filtrados por empresa, client-side)
 * + departamento/puesto + inicio + ref nómina. Reusado por alta de empleo y por
 * traslado. Los `name` son fijos (`company_id`, `site_id`, …).
 */
export function EmploymentFields({
  lookups,
  defaults,
  startLabel = "Fecha de inicio *",
}: {
  lookups: EmploymentLookups;
  defaults?: EmploymentDefaults;
  startLabel?: string;
}) {
  const [companyId, setCompanyId] = useState<number | "">(defaults?.company_id ?? "");
  const sites = lookups.sites.filter((s) => s.company_id === companyId);
  const groups = lookups.groups.filter((g) => g.company_id === companyId);

  return (
    <div className="grid grid-cols-2 gap-2">
      <label className={LABEL}>
        Empresa *
        <select
          name="company_id"
          required
          className={INPUT}
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value === "" ? "" : Number(e.target.value))}
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
        Sede
        <select name="site_id" className={INPUT} defaultValue={defaults?.site_id ?? ""} disabled={!companyId}>
          <option value="">— sin sede —</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        Grupo (horario)
        <select
          name="employee_group_id"
          className={INPUT}
          defaultValue={defaults?.employee_group_id ?? ""}
          disabled={!companyId}
        >
          <option value="">— sin grupo —</option>
          {groups.map((g) => (
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
        <select name="position_id" className={INPUT} defaultValue={defaults?.position_id ?? ""}>
          <option value="">— sin puesto —</option>
          {lookups.positions.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

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
