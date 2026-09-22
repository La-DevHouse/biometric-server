"use client";

import { useState } from "react";
import { FiltersDialog } from "@/components/ui/FiltersDialog";
import { Field } from "@/components/ui/Field";
import { FIELD_INPUT } from "@/components/ui/fieldStyles";

/**
 * Ejemplo vivo con estado local — las páginas reales (Empleados, Asistencia)
 * lo manejan por querystring (useSearchParams + router.push), pero acá eso
 * ensuciaría la URL de esta misma página de referencia.
 */
export function StyleguideFiltersDemo() {
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState("");
  const activeCount = [q, estado].filter(Boolean).length;

  return (
    <FiltersDialog
      activeCount={activeCount}
      onClear={() => {
        setQ("");
        setEstado("");
      }}
    >
      <Field label="Buscar">
        <input className={FIELD_INPUT} value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <Field label="Estado">
        <select className={FIELD_INPUT} value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">todos</option>
          <option value="activo">Activo</option>
          <option value="inactivo">Inactivo</option>
        </select>
      </Field>
    </FiltersDialog>
  );
}
