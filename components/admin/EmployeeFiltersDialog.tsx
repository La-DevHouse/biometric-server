"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FiltersDialog } from "@/components/ui/FiltersDialog";
import { FIELD_INPUT as INPUT_CLASS, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

/**
 * Los 5 filtros de Empleados desordenaban la barra superior — se agrupan
 * en el ícono de embudo estándar (components/ui/FiltersDialog), en vez de
 * una fila de <select> sueltos. Controlado por URL, no un <form method=get>.
 */
export function EmployeeFiltersDialog({
  groups,
  companies,
  sites,
}: {
  groups: { id: number; name: string }[];
  companies: { id: number; name: string }[];
  sites: { id: number; name: string; companyName: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const grupo = searchParams.get("grupo") ?? "";
  const empresa = searchParams.get("empresa") ?? "";
  const sede = searchParams.get("sede") ?? "";
  const estado = searchParams.get("estado") ?? "";
  const activeCount = [q, grupo, empresa, sede, estado].filter(Boolean).length;

  function update(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <FiltersDialog activeCount={activeCount} onClear={() => startTransition(() => router.push(pathname))}>
      <label className={LABEL}>
        Buscar
        <input
          className={INPUT_CLASS}
          defaultValue={q}
          placeholder="nombre o documento"
          disabled={isPending}
          onChange={(e) => update({ q: e.target.value })}
        />
      </label>
      <label className={LABEL}>
        Grupo
        <select
          className={INPUT_CLASS}
          value={grupo}
          disabled={isPending}
          onChange={(e) => update({ grupo: e.target.value })}
        >
          <option value="">todos</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Empresa
        <select
          className={INPUT_CLASS}
          value={empresa}
          disabled={isPending}
          onChange={(e) => update({ empresa: e.target.value })}
        >
          <option value="">todas</option>
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
          className={INPUT_CLASS}
          value={sede}
          disabled={isPending}
          onChange={(e) => update({ sede: e.target.value })}
        >
          <option value="">todas</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>
              {s.companyName} — {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={LABEL}>
        Estado
        <select
          className={INPUT_CLASS}
          value={estado}
          disabled={isPending}
          onChange={(e) => update({ estado: e.target.value })}
        >
          <option value="">todos</option>
          <option value="activo">Con empleo activo</option>
          <option value="pool">Pool (sin vínculo)</option>
        </select>
      </label>
    </FiltersDialog>
  );
}
