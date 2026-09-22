import type { ReactNode } from "react";
import { FIELD_LABEL } from "./fieldStyles";

/**
 * El wrapper "Nombre *  <span de hint>  <input/>" que se repetía a mano en
 * cada diálogo. `children` es el control (input/select) — este componente
 * solo resuelve la etiqueta, el asterisco de requerido y el hint opcional,
 * ya con FIELD_LABEL aplicado.
 */
export function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className={FIELD_LABEL}>
      <span>
        {label}
        {required && <span className="text-danger-600"> *</span>}
        {hint && <span className="text-neutral-600 normal-case tracking-normal"> {hint}</span>}
      </span>
      {children}
    </label>
  );
}
