"use client";

import { docPrefixes, type DocKind } from "@/lib/documento";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

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
    <div className={`flex flex-col gap-1 text-xs text-text/70 ${className ?? ""}`}>
      <span>
        {label} {required && "*"}
        {hint && <span className="text-text/40"> {hint}</span>}
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
    </div>
  );
}
