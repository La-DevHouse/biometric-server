-- Estatus de la persona (2026-11-16): activo, de vacaciones o desactivado. Se
-- edita a mano en la ficha y lo trae la importación de Galepso (columna STATUS).
-- Todas las personas que ya existen quedan activas.
CREATE TYPE "employee_status" AS ENUM ('active', 'vacation', 'inactive');
ALTER TABLE "employee" ADD COLUMN "status" "employee_status" NOT NULL DEFAULT 'active';
CREATE INDEX "employee_status_idx" ON "employee"("status");
