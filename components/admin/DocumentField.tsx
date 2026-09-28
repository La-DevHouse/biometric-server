"use client";

import { docPrefixes, type DocKind } from "@/lib/documento";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_HINT } from "@/components/ui/fieldStyles";

/**
 * Tipo de documento (prefijo en <select>) + número (campo numérico).
 * Emite dos campos de formulario: `<prefixName>` y `<numberName>`. El server
 * action los recombina con `joinDoc` de lib/documento.
 */
export function DocumentField({
  kind,
  prefixName,
  numberName,
  label,
  required,
  defaultPrefix = "",
  defaultNumber = "",
  hint,
  className,
}: {
  kind: DocKind;
  prefixName: string;
  numberName: string;
  label: string;
  required?: boolean;
  defaultPrefix?: string;
  defaultNumber?: string;
  hint?: string;
  className?: string;
}) {
  const prefixes = docPrefixes(kind);
  return (
    // Mismo estilo de etiqueta que el resto de los campos (FIELD_LABEL: mono,
    // mayúsculas): antes salía en letra normal y desentonaba en el formulario.
    // La ayuda va debajo del campo, como pide FIELD_HINT.
    <div className={`${LABEL} ${className ?? ""}`}>
      <span>
        {label} {required && "*"}
      </span>
      <div className="flex gap-2">
        <select
          name={prefixName}
          required={required}
          defaultValue={defaultPrefix}
          className={`${INPUT} w-16! flex-none`}
        >
          <option value="">—</option>
          {prefixes.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          name={numberName}
          inputMode="numeric"
          pattern="[0-9]*"
          required={required}
          defaultValue={defaultNumber}
          placeholder="12345678"
          className={INPUT}
        />
      </div>
      {hint && <span className={FIELD_HINT}>{hint}</span>}
    </div>
  );
}
