"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FiltersDialog } from "@/components/ui/FiltersDialog";
import { Combobox } from "@/components/ui/Combobox";
import { FIELD_INPUT as INPUT_CLASS, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

/**
 * Búsqueda + filtros de la lista de Equipos (docs/11 E1). La búsqueda queda a
 * la vista (nombre, serie, empresa, sede); empresa y estado van en el embudo
 * estándar. Todo controlado por URL, así un link puede llegar ya filtrado
 * (ej. el widget del Inicio → ?estado=online).
 */
export function DeviceFilters({ companies }: { companies: { id: number; name: string; tax_id: string | null }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const q = searchParams.get("q") ?? "";
  const empresa = searchParams.get("empresa") ?? "";
  const estado = searchParams.get("estado") ?? "";
  const activeCount = [empresa, estado].filter(Boolean).length;

  function update(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        type="search"
        aria-label="Buscar equipos"
        className={`${INPUT_CLASS} w-full max-w-xs`}
        defaultValue={q}
        placeholder="Buscar nombre, serie, empresa o sede…"
        onChange={(e) => update({ q: e.target.value })}
      />
      <FiltersDialog
        activeCount={activeCount}
        onClear={() => update({ empresa: "", estado: "" })}
      >
        <div className={LABEL}>
          Empresa
          <Combobox
            ariaLabel="Empresa"
            options={companies.map((c) => ({ value: String(c.id), label: c.name, hint: c.tax_id ?? undefined }))}
            emptyLabel="todas"
            value={empresa}
            disabled={isPending}
            onChange={(v) => update({ empresa: v })}
            placeholder="Buscar empresa o RIF…"
          />
        </div>
        <label className={LABEL}>
          Estado
          <select
            className={INPUT_CLASS}
            value={estado}
            disabled={isPending}
            onChange={(e) => update({ estado: e.target.value })}
          >
            <option value="">todos</option>
            <option value="online">En línea</option>
            <option value="offline">Desconectado</option>
            <option value="pendiente">Pendiente de asignar</option>
          </select>
        </label>
      </FiltersDialog>
    </div>
  );
}
