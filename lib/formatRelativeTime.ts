/** "hace 9 s" / "hace 3 h" style relative time, matching the design's copy. No date library needed for this granularity. */
export function formatRelativeTime(epochMs: number | null | undefined): string {
  if (!epochMs) return "nunca";
  const diffSec = Math.max(0, Math.round((Date.now() - epochMs) / 1000));

  if (diffSec < 60) return `hace ${diffSec} s`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `hace ${diffHr} h`;
  const diffDay = Math.round(diffHr / 24);
  return `hace ${diffDay} d`;
}
