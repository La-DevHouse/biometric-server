"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { FiltersDialog } from "@/components/ui/FiltersDialog";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export type UrlFilterField =
  | { name: string; label: string; type: "date" }
  | { name: string; label: string; type: "text"; placeholder?: string }
  | { name: string; label: string; type: "select"; options: { value: string; label: string }[]; emptyLabel?: string };

/**
 * Filtros de una lista, detrás del ícono de embudo estándar (FiltersDialog) y
 * controlados por URL (?from=&to=…), como en Empleados y Equipos. Declarativo:
 * cada pantalla pasa sus campos. El texto se aplica con un pequeño debounce;
 * fechas y selects, al cambiar.
 */
export function UrlFilters({ fields }: { fields: UrlFilterField[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const activeCount = fields.filter((f) => searchParams.get(f.name)).length;

  function update(name: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  function clearAll() {
    const params = new URLSearchParams(searchParams.toString());
    for (const f of fields) params.delete(f.name);
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <FiltersDialog activeCount={activeCount} onClear={clearAll}>
      {fields.map((f) => {
        const value = searchParams.get(f.name) ?? "";
        if (f.type === "select") {
          return (
            <label key={f.name} className={LABEL}>
              {f.label}
              <select className={INPUT} value={value} disabled={isPending} onChange={(e) => update(f.name, e.target.value)}>
                <option value="">{f.emptyLabel ?? "todas"}</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        }
        if (f.type === "date") {
          return (
            <label key={f.name} className={LABEL}>
              {f.label}
              <input type="date" className={INPUT} value={value} disabled={isPending} onChange={(e) => update(f.name, e.target.value)} />
            </label>
          );
        }
        return (
          <label key={f.name} className={LABEL}>
            {f.label}
            <input
              type="search"
              className={INPUT}
              defaultValue={value}
              placeholder={f.placeholder}
              onChange={(e) => {
                const v = e.target.value.trim();
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => update(f.name, v), 300);
              }}
            />
          </label>
        );
      })}
    </FiltersDialog>
  );
}
