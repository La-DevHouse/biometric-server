-- Renombre de dominio: "Grupo de empleados" (employee_group) -> "Horario" (schedule_group).
-- Motivo: la UI ya usa "Grupo" para client_company.is_group (grupos de empresa, ej. "Grupo
-- Farmalido"). Mantener employee_group con la palabra "grupo" en la interfaz colisionaba con
-- ese concepto. Es un ALTER de renombre puro (tabla/columnas/constraints/índices/secuencia),
-- sin pérdida de datos.

-- Tabla + secuencia
ALTER TABLE "employee_group" RENAME TO "schedule_group";
ALTER SEQUENCE "employee_group_id_seq" RENAME TO "schedule_group_id_seq";

-- Constraints e índices propios de schedule_group
ALTER TABLE "schedule_group" RENAME CONSTRAINT "employee_group_pkey" TO "schedule_group_pkey";
ALTER TABLE "schedule_group" RENAME CONSTRAINT "employee_group_company_id_fkey" TO "schedule_group_company_id_fkey";
ALTER INDEX "employee_group_company_id_idx" RENAME TO "schedule_group_company_id_idx";

-- employment.employee_group_id -> employment.schedule_group_id
ALTER TABLE "employment" RENAME COLUMN "employee_group_id" TO "schedule_group_id";
ALTER TABLE "employment" RENAME CONSTRAINT "employment_employee_group_id_fkey" TO "employment_schedule_group_id_fkey";
ALTER INDEX "employment_employee_group_id_idx" RENAME TO "employment_schedule_group_id_idx";

-- shift.employee_group_id -> shift.schedule_group_id
ALTER TABLE "shift" RENAME COLUMN "employee_group_id" TO "schedule_group_id";
ALTER TABLE "shift" RENAME CONSTRAINT "shift_employee_group_id_fkey" TO "shift_schedule_group_id_fkey";
ALTER INDEX "shift_employee_group_id_effective_from_idx" RENAME TO "shift_schedule_group_id_effective_from_idx";
