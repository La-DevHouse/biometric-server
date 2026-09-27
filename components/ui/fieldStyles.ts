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
// Alto y padding salen de --control-h / --control-px (40/12 escritorio,
// 48/14 mobile — app/globals.css); el cuerpo de 15/16px de text-sm.
export const FIELD_INPUT =
  "h-(--control-h) px-(--control-px) text-sm font-sans normal-case tracking-normal text-text bg-surface border border-neutral-500 rounded-none w-full outline-none " +
  "focus:border-accent focus:ring-2 focus:ring-accent-200 disabled:opacity-60";

// Mono + uppercase + tracking, como el resto del "chrome" del sistema nuevo.
// Mono 12 / +.12em (+.10em en mobile), como "Label de campo" de la maqueta.
export const FIELD_LABEL =
  "flex flex-col gap-[5px] font-mono text-label uppercase tracking-[0.12em] max-md:tracking-[0.1em] text-neutral-800";
