// Nombres de los estados del día tal como se muestran (docs/16).
import type { DayStatus } from "./compute";

export const DAY_STATUS_LABEL: Record<DayStatus, string> = {
  present: "Presente",
  late: "Tardanza",
  early_leave: "Salida anticipada",
  absent: "Ausente",
  incomplete: "Incompleto",
  rest_day: "Día libre",
  rest_day_worked: "Día libre trabajado",
  no_schedule: "Sin horario",
};

/** Plural para resúmenes ("3 tardanzas"). */
export const DAY_STATUS_PLURAL: Record<DayStatus, string> = {
  present: "presentes",
  late: "tardanzas",
  early_leave: "salidas anticipadas",
  absent: "ausencias",
  incomplete: "incompletos",
  rest_day: "días libres",
  rest_day_worked: "días libres trabajados",
  no_schedule: "sin horario",
};

/** "1 tardanza" / "3 tardanzas". */
export function statusCount(status: DayStatus, n: number): string {
  return `${n} ${n === 1 ? DAY_STATUS_LABEL[status].toLowerCase() : DAY_STATUS_PLURAL[status]}`;
}
