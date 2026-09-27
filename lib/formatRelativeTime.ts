/**
 * Tiempo relativo estándar del panel: "justo ahora" (< 1 min), "hace 3 min",
 * "hace 2 h", "hace 1 día" / "hace 5 días". En minúscula porque casi siempre
 * va dentro de una frase ("2023081158 · hace 2 h", "leído hace 3 min"); donde
 * abre una línea, se capitaliza en el punto de uso. Trunca (no redondea): a los
 * 59 min dice "hace 59 min", nunca "hace 60 min" ni "hace 1 h" antes de tiempo.
 */
export function formatRelativeTime(epochMs: number | null | undefined, now: number = Date.now()): string {
  if (!epochMs) return "nunca";
  const diffSec = Math.max(0, Math.floor((now - epochMs) / 1000));

  if (diffSec < 60) return "justo ahora";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDay = Math.floor(diffHr / 24);
  return diffDay === 1 ? "hace 1 día" : `hace ${diffDay} días`;
}

/** Fecha y hora exacta en Caracas, para el tooltip junto a un tiempo relativo. */
export function formatDateTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "";
  return new Date(epochMs).toLocaleString("es-VE", {
    timeZone: "America/Caracas",
    dateStyle: "short",
    timeStyle: "medium",
  });
}
