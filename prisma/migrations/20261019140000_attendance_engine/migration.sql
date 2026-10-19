-- Motor de asistencia (Hito 4, docs/16-motor-asistencia.md).
--
-- Estados nuevos del día: incompleto (una sola marcación), día libre, día libre
-- trabajado, y sin horario (el contrato no tiene horario: solo horas).
ALTER TYPE "attendance_status" ADD VALUE IF NOT EXISTS 'incomplete';
ALTER TYPE "attendance_status" ADD VALUE IF NOT EXISTS 'rest_day';
ALTER TYPE "attendance_status" ADD VALUE IF NOT EXISTS 'rest_day_worked';
ALTER TYPE "attendance_status" ADD VALUE IF NOT EXISTS 'no_schedule';

-- Minutos de tardanza y de salida anticipada (se guardan los dos aunque el
-- estado principal sea "Tardanza"), jornada esperada y cuántas marcaciones hubo.
ALTER TABLE "attendance_day"
  ADD COLUMN "late_minutes" INTEGER,
  ADD COLUMN "early_leave_minutes" INTEGER,
  ADD COLUMN "scheduled_minutes" INTEGER,
  ADD COLUMN "mark_count" INTEGER NOT NULL DEFAULT 0;

-- Un día por CONTRATO y fecha (no por persona): alguien con contrato en dos
-- empresas del grupo tiene un día en cada una. Sin filas en producción todavía.
DELETE FROM "attendance_day" WHERE "employment_id" IS NULL;
DROP INDEX "attendance_day_employee_id_date_key";
ALTER TABLE "attendance_day" ALTER COLUMN "employment_id" SET NOT NULL;
ALTER TABLE "attendance_day" DROP CONSTRAINT "attendance_day_employment_id_fkey";
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_employment_id_fkey"
  FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "attendance_day_employment_id_date_key" ON "attendance_day"("employment_id", "date");
CREATE INDEX "attendance_day_employee_id_date_idx" ON "attendance_day"("employee_id", "date");
