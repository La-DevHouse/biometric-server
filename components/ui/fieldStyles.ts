/**
 * Único origen de verdad para el estilo de campos de formulario en diálogos.
 * Antes cada diálogo declaraba su propio `const INPUT = "..."` / `const LABEL
 * = "..."` — 24 copias idénticas repartidas por components/admin/*.tsx, lo
 * que significa que un cambio de estilo (o un fix) requiere acordarse de
 * tocar los 24 archivos. Un fix real quedó afuera de uno de ellos hace poco
 * por exactamente esta razón. Este archivo es el único lugar que se toca.
 */
// font-sans + normal-case + tracking-normal explícitos: FIELD_LABEL (abajo)
// pone el <label> que envuelve a este <input> en font-mono uppercase con
// tracking ancho, y eso se hereda si no se corta acá — el valor que escribe
// la persona no puede salir en mayúscula monoespaciada ni con letras separadas
// (el placeholder también hereda, así que el corte de tracking aplica igual).
// Medidas en px exactos (32 alto, 9 padding) porque la escala de spacing de
// 3.4px del resto del sistema no cae justo en los valores de la maqueta.
export const FIELD_INPUT =
  "h-[32px] px-[9px] text-[13px] font-sans normal-case tracking-normal bg-surface border border-neutral-500 rounded-none w-full outline-none " +
  "focus:border-accent focus:ring-2 focus:ring-accent-200";

// Mono + uppercase + tracking, como el resto del "chrome" del sistema nuevo.
export const FIELD_LABEL =
  "flex flex-col gap-[4px] font-mono text-[11px] uppercase tracking-[0.14em] text-neutral-800";
