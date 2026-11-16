"use client";

import { useState } from "react";
import type { EmploymentLookups } from "@/lib/lookups";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import { Combobox } from "@/components/ui/Combobox";

export interface EmploymentDefaults {
  company_id?: number | null;
  site_id?: number | null;
  /** Nombre de la sede actual, por si ya no está activa (no viene en `lookups`). */
  site_name?: string | null;
  schedule_group_id?: number | null;
  position_id?: number | null;
  department_id?: number | null;
  payroll_ref?: string | null;
  payroll_type?: "quincenal" | "semanal" | null;
  start_date?: string | null; // YYYY-MM-DD
}

/**
 * Campos de un contrato de trabajo: empresa (todo el ancho) + sede y horario de esa
 * empresa + departamento/puesto + nómina + inicio. Reusado por alta de contrato y
 * por su edición. Los `name` son fijos (`company_id`, `site_id`, …).
 * La sede es SOLO INFORMATIVA (lib/employmentSite): el alcance de la huella sigue
 * saliendo de todas las sedes de la empresa (y su grupo) — docs/10 R6. Con una sola
 * sede se asigna sola; con varias es obligatoria. Al editar, la empresa queda fija
 * (`lockCompany`, docs/11 P2): otra empresa = baja + contrato nuevo.
 */
export function EmploymentFields({
  lookups,
  defaults,
  startLabel = "Fecha de inicio *",
  lockCompany,
  onStartDateChange,
}: {
  lookups: EmploymentLookups;
  defaults?: EmploymentDefaults;
  startLabel?: string;
  /** Edición: muestra la empresa sin poder cambiarla (se usa el nombre si ya no está activa). */
  lockCompany?: { id: number; name: string };
  onStartDateChange?: (date: string) => void;
}) {
  const [companyId, setCompanyId] = useState<number | "">(defaults?.company_id ?? "");
  const [siteSel, setSiteSel] = useState<string>(defaults?.site_id != null ? String(defaults.site_id) : "");
  const [positionSel, setPositionSel] = useState<string>(
    defaults?.position_id != null ? String(defaults.position_id) : ""
  );
  const schedules = lookups.schedules.filter((g) => g.company_id === companyId);
  const company = companyId === "" ? null : lookups.companies.find((c) => c.id === companyId) ?? null;

  // Sedes de la empresa; la del contrato aunque ya no esté activa.
  const sites = [...(company?.sites ?? [])];
  if (defaults?.site_id != null && defaults.company_id === companyId && !sites.some((s) => s.id === defaults.site_id)) {
    sites.push({ id: defaults.site_id, name: `${defaults.site_name ?? "Sede"} (inactiva)` });
  }
  const onlySite = sites.length === 1 ? sites[0] : null;

  // modelo de negocio de la empresa elegida → filtra los puestos
  const effectiveBm = company?.business_model_id ?? null;
  const positions = lookups.positions.filter(
    (p) =>
      p.business_model_ids.length === 0 || // genérico
      (effectiveBm != null && p.business_model_ids.includes(effectiveBm))
  );

  return (
    <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
      {lockCompany ? (
        <div className={`${LABEL} col-span-2`}>
          Empresa
          <input type="hidden" name="company_id" value={lockCompany.id} />
          <span className="flex h-(--control-h) items-center text-sm font-medium normal-case tracking-normal font-sans text-text">{lockCompany.name}</span>
        </div>
      ) : (
        <div className={`${LABEL} col-span-2`}>
          Empresa *
          <Combobox
            name="company_id"
            required
            ariaLabel="Empresa"
            options={lookups.companies.map((c) => ({ value: String(c.id), label: c.name, hint: c.tax_id ?? undefined }))}
            value={companyId === "" ? "" : String(companyId)}
            onChange={(v) => {
              setCompanyId(v === "" ? "" : Number(v));
              setSiteSel(""); // la sede es de la empresa: al cambiarla se vuelve a elegir
            }}
            placeholder="Buscar empresa o RIF…"
          />
        </div>
      )}

      <label className={LABEL}>
        {sites.length > 1 ? "Sede *" : "Sede"}
        {onlySite ? (
          <>
            <input type="hidden" name="site_id" value={onlySite.id} />
            <select className={INPUT} value={onlySite.id} disabled aria-label="Sede">
              <option value={onlySite.id}>{onlySite.name}</option>
            </select>
          </>
        ) : (
          <select
            name="site_id"
            className={INPUT}
            value={siteSel}
            onChange={(e) => setSiteSel(e.target.value)}
            required={sites.length > 1}
            disabled={!company}
          >
            <option value="">{company ? "— elija la sede —" : "— elija la empresa —"}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
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

      {defaults?.schedule_group_id !== undefined && (
        <span className="col-span-2 text-xs font-normal text-text/70">
          Un cambio de horario aquí rige desde hoy. Para otra fecha use Empresa → Empleados → Asignar horario.
        </span>
      )}

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
        Tipo de nómina
        <select name="payroll_type" className={INPUT} defaultValue={defaults?.payroll_type ?? ""}>
          <option value="">— sin nómina —</option>
          <option value="quincenal">Quincenal</option>
          <option value="semanal">Semanal</option>
        </select>
      </label>

      <label className={LABEL}>
        Ref. nómina
        <input name="payroll_ref" className={INPUT} defaultValue={defaults?.payroll_ref ?? ""} />
      </label>

      <label className={`${LABEL} col-span-2`}>
        {startLabel}
        <input
          name="start_date"
          type="date"
          required
          className={INPUT}
          defaultValue={defaults?.start_date ?? ""}
          onChange={(e) => onStartDateChange?.(e.target.value)}
        />
      </label>
    </div>
  );
}
