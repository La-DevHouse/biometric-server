/** "YYYY-MM-DD" → "DD/MM/YYYY". */
function dmy(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return d && m && y ? `${d}/${m}/${y}` : ymd;
}

/**
 * Resumen en una línea de los filtros aplicados, para mostrar junto al ícono
 * de filtros (que los esconde en un diálogo): "Del 01/09/2026 al 15/09/2026 ·
 * Sede Centro · “juan”", o "Todas las fechas" si no hay ninguno.
 */
export function filterSummary(from?: string, to?: string, ...extra: Array<string | null | undefined>): string {
  const range =
    from && to ? `Del ${dmy(from)} al ${dmy(to)}` : from ? `Desde el ${dmy(from)}` : to ? `Hasta el ${dmy(to)}` : "Todas las fechas";
  return [range, ...extra.filter(Boolean).map((x) => (x!.startsWith("Sede") ? x! : `“${x}”`))].join(" · ");
}
