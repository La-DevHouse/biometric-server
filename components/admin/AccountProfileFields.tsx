"use client";

import { useMemo, useState } from "react";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_HINT } from "@/components/ui/fieldStyles";
import { PROFILE_HINT, PROFILE_LABEL, type Profile } from "@/lib/accessLabels";

export interface AccessCompany {
  id: number;
  name: string;
  groupId: number | null;
  groupName: string | null;
}

export interface AccountProfile {
  role: Profile;
  allCompanies: boolean;
  companyIds: number[];
}

/**
 * Perfil de una cuenta (docs/18): Administrador / Solo lectura / Socio y, si no
 * es administrador, a qué empresas tiene acceso. Campos `role`, `scope`
 * ("all" | "some") y `company_ids` (varios).
 */
export function AccountProfileFields({
  companies,
  initial,
  disabledRole,
}: {
  companies: AccessCompany[];
  initial?: AccountProfile;
  /** La propia cuenta no cambia su perfil (para no quedarse afuera). */
  disabledRole?: boolean;
}) {
  const [role, setRole] = useState<Profile>(initial?.role ?? "operator");
  const [scope, setScope] = useState<"all" | "some">(initial && !initial.allCompanies ? "some" : initial ? "all" : "some");
  const [picked, setPicked] = useState<Set<number>>(new Set(initial?.companyIds ?? []));
  const [q, setQ] = useState("");

  const limited = role === "operator" || (role === "viewer" && scope === "some");
  const groups = useMemo(() => {
    const m = new Map<number, { name: string; ids: number[] }>();
    for (const c of companies)
      if (c.groupId != null) {
        const g = m.get(c.groupId) ?? { name: c.groupName ?? "", ids: [] };
        g.ids.push(c.id);
        m.set(c.groupId, g);
      }
    return [...m.entries()].filter(([, g]) => g.ids.length > 1);
  }, [companies]);
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const shown = companies.filter((c) => !q || norm(`${c.name} ${c.groupName ?? ""}`).includes(norm(q)));

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const addGroup = (ids: number[]) => setPicked((s) => new Set([...s, ...ids]));

  return (
    <div className="flex flex-col gap-3">
      <label className={LABEL}>
        Perfil *
        <select
          name="role"
          className={INPUT}
          value={role}
          onChange={(e) => setRole(e.target.value as Profile)}
          disabled={disabledRole}
        >
          {(["admin", "viewer", "operator"] as Profile[]).map((p) => (
            <option key={p} value={p}>
              {PROFILE_LABEL[p]}
            </option>
          ))}
        </select>
        {/* Un select deshabilitado no se envía: el perfil propio va oculto. */}
        {disabledRole && <input type="hidden" name="role" value={role} />}
        <span className={FIELD_HINT}>
          {PROFILE_HINT[role]}
          {disabledRole && " No puede cambiar el perfil de su propia cuenta."}
        </span>
      </label>

      {role === "viewer" && (
        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className={LABEL}>Empresas</legend>
          {(["all", "some"] as const).map((v) => (
            <label key={v} className="flex items-center gap-2 text-sm">
              <input type="radio" name="scope" value={v} checked={scope === v} onChange={() => setScope(v)} />
              {v === "all" ? "Todas las empresas" : "Solo las empresas elegidas"}
            </label>
          ))}
        </fieldset>
      )}

      {limited && (
        <div className="flex flex-col gap-2">
          <div className={LABEL}>
            Empresas con acceso * <span className={FIELD_HINT}>({picked.size} elegida{picked.size === 1 ? "" : "s"})</span>
          </div>
          <input
            className={INPUT}
            placeholder="Buscar empresa o grupo…"
            aria-label="Buscar empresa"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {groups.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-text/70">Agregar grupo:</span>
              {groups.map(([gid, g]) => (
                <button
                  key={gid}
                  type="button"
                  onClick={() => addGroup(g.ids)}
                  className="cursor-pointer border-0 bg-transparent p-0 text-sm text-accent underline-offset-2 hover:underline"
                >
                  todas las de {g.name} ({g.ids.length})
                </button>
              ))}
            </div>
          )}
          <ul className="m-0 flex max-h-[40vh] list-none flex-col gap-1 overflow-y-auto border border-neutral-300 p-2">
            {shown.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="company_ids"
                    value={c.id}
                    checked={picked.has(c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span className="flex-1">{c.name}</span>
                  {c.groupName && <span className="text-xs text-text/60">{c.groupName}</span>}
                </label>
              </li>
            ))}
            {shown.length === 0 && <li className="text-sm text-text/60">Ninguna empresa con ese nombre.</li>}
          </ul>
          {/* Las elegidas que el buscador oculta igual se envían. */}
          {[...picked]
            .filter((id) => !shown.some((c) => c.id === id))
            .map((id) => (
              <input key={id} type="hidden" name="company_ids" value={id} />
            ))}
          <span className={FIELD_HINT}>
            Si después se agrega una empresa a un grupo, no se le da acceso automáticamente.
          </span>
        </div>
      )}
    </div>
  );
}
