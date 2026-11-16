// Estatus de la persona (docs/14 §3 "Estatus"): activo, de vacaciones o
// desactivado. Se edita a mano en la ficha y lo trae la importación de Galepso
// (columna STATUS del Roster). Es informativo: no cierra contratos ni saca a
// nadie de los equipos (eso sigue siendo "Dar de baja" el contrato).
import { normKey } from "./import/normalize";

export const EMPLOYEE_STATUSES = ["active", "vacation", "inactive"] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "Activo",
  vacation: "De vacaciones",
  inactive: "Desactivado",
};

export const EMPLOYEE_STATUS_TAG: Record<EmployeeStatus, "accent" | "accent2" | "neutral"> = {
  active: "accent",
  vacation: "accent2",
  inactive: "neutral",
};

export function isEmployeeStatus(v: unknown): v is EmployeeStatus {
  return typeof v === "string" && (EMPLOYEE_STATUSES as readonly string[]).includes(v);
}

/** Lo que escribe Galepso (y variantes a mano en un .xlsx) → estatus. */
const FROM_TEXT: Record<string, EmployeeStatus> = {
  activo: "active",
  activa: "active",
  vacaciones: "vacation",
  vacacion: "vacation",
  "de vacaciones": "vacation",
  "en vacaciones": "vacation",
  inactivo: "inactive",
  inactiva: "inactive",
  desactivado: "inactive",
  desactivada: "inactive",
  egresado: "inactive",
  egresada: "inactive",
  retirado: "inactive",
  retirada: "inactive",
  liquidado: "inactive",
  liquidada: "inactive",
};

/**
 * Texto del archivo → estatus. Vacío = null (el archivo no lo dice: no se toca).
 * Un texto que no se reconoce = error: la fila se rechaza, nunca se adivina.
 */
export function parseEmployeeStatus(raw: unknown): { value: EmployeeStatus | null } | { error: string } {
  const k = normKey(raw);
  if (!k) return { value: null };
  const v = FROM_TEXT[k];
  if (v) return { value: v };
  return { error: `Estatus "${String(raw).trim()}" no reconocido. Use ACTIVO, VACACIONES o INACTIVO.` };
}
