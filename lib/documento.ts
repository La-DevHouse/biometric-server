// Documentos de identidad venezolanos: prefijo (letra) + número.
// Se guarda normalizado como "PREFIJO-dígitos" en una sola columna
// (employee.national_id, employee.tax_id, client_company.tax_id). El formulario
// lo divide en dos campos (select + numérico) y el server action recombina.

export const CEDULA_PREFIXES = ["V", "E"] as const;
export const RIF_PREFIXES = ["V", "E", "J", "G", "P"] as const;

export type DocKind = "cedula" | "rif";

export function docPrefixes(kind: DocKind): readonly string[] {
  return kind === "cedula" ? CEDULA_PREFIXES : RIF_PREFIXES;
}

/** Separa un valor guardado ("V-12345678") en { prefix, number } para precargar el form. */
export function splitDoc(stored: string | null | undefined): { prefix: string; number: string } {
  if (!stored) return { prefix: "", number: "" };
  const m = stored.trim().toUpperCase().match(/^([A-Z])[-\s]?(\d+)/);
  if (m) return { prefix: m[1], number: m[2] };
  return { prefix: "", number: stored.replace(/\D/g, "") };
}

/**
 * Combina prefijo + número al formato de guardado, validando.
 * `min`/`max` = cantidad de dígitos permitida (default por tipo).
 */
export function joinDoc(
  prefixRaw: string,
  numberRaw: string,
  kind: DocKind,
  opts: { min?: number; max?: number } = {}
): { value: string } | { error: string } {
  const prefix = prefixRaw.trim().toUpperCase();
  const digits = numberRaw.replace(/\D/g, "");
  const min = opts.min ?? (kind === "cedula" ? 5 : 8);
  const max = opts.max ?? 10;
  const label = kind === "cedula" ? "La cédula" : "El RIF";

  if (!prefix) return { error: `${label}: elegí el tipo de documento.` };
  if (!docPrefixes(kind).includes(prefix))
    return { error: `${label}: tipo de documento inválido.` };
  if (!digits) return { error: `${label}: falta el número.` };
  if (digits.length < min || digits.length > max)
    return { error: `${label}: el número debe tener entre ${min} y ${max} dígitos.` };

  return { value: `${prefix}-${digits}` };
}
