-- Reconciliador de huellas (docs/10-reestructura-dominio-sync.md, PR 2).
--
-- 1. employee_fingerprint deja de identificarse por (empleado, slot): el slot es
--    orden de registro de UN equipo, no identidad de dedo (docs/05). Se renombra
--    finger_index -> source_backup_number (solo informativo) y se agrega status.
-- 2. device_fingerprint_slot: registro de procedencia por (equipo, usuario, slot)
--    — physical | propagated. Es lo que hace idempotente al reconciliador (la
--    escritura por software no detecta duplicados, T8b).
-- 3. sync_run (auditoría de corridas + contadores para el detector de cambios)
--    y sync_hold (freno de borrado masivo).
-- 4. commands.priority / operations.priority: el reconciliador (200) no le gana
--    la cola a las acciones del panel (100).
-- Sin efecto sobre equipos físicos. Reversible salvo el rename (sin pérdida de datos).

-- === enums ===
CREATE TYPE "fingerprint_origin" AS ENUM ('physical', 'propagated');
CREATE TYPE "fingerprint_slot_state" AS ENUM ('present', 'pending_write', 'pending_delete', 'error');
CREATE TYPE "sync_kind" AS ENUM ('fingerprints', 'attendance_pull', 'attendance_compute');
CREATE TYPE "sync_trigger" AS ENUM ('cron', 'manual', 'event');
CREATE TYPE "sync_hold_resolution" AS ENUM ('approved', 'rejected');

-- === 1. employee_fingerprint ===
DROP INDEX "employee_fingerprint_employee_id_finger_index_key";
DROP INDEX "employee_fingerprint_employee_id_idx";
ALTER TABLE "employee_fingerprint" RENAME COLUMN "finger_index" TO "source_backup_number";
ALTER TABLE "employee_fingerprint" ALTER COLUMN "source_backup_number" DROP NOT NULL;
ALTER TABLE "employee_fingerprint" ADD COLUMN "status" "record_status" NOT NULL DEFAULT 'active';
CREATE INDEX "employee_fingerprint_employee_id_status_captured_at_idx"
  ON "employee_fingerprint"("employee_id", "status", "captured_at");

-- === 2. device_fingerprint_slot ===
CREATE TABLE "device_fingerprint_slot" (
    "id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "device_user_id" TEXT NOT NULL,
    "backup_number" INTEGER NOT NULL,
    "fingerprint_id" INTEGER,
    "origin" "fingerprint_origin" NOT NULL,
    "state" "fingerprint_slot_state" NOT NULL DEFAULT 'present',
    "last_seen_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "device_fingerprint_slot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_fingerprint_slot_dev_id_device_user_id_backup_number_key"
  ON "device_fingerprint_slot"("dev_id", "device_user_id", "backup_number");
CREATE INDEX "device_fingerprint_slot_fingerprint_id_idx" ON "device_fingerprint_slot"("fingerprint_id");
ALTER TABLE "device_fingerprint_slot" ADD CONSTRAINT "device_fingerprint_slot_dev_id_fkey"
  FOREIGN KEY ("dev_id") REFERENCES "devices"("dev_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_fingerprint_slot" ADD CONSTRAINT "device_fingerprint_slot_fingerprint_id_fkey"
  FOREIGN KEY ("fingerprint_id") REFERENCES "employee_fingerprint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: cada huella ya capturada vino de un slot concreto de su equipo de
-- origen — se registra como `physical` en ese slot, bajo el usuario con el que la
-- persona está enrolada ahí (si lo está).
INSERT INTO "device_fingerprint_slot"
  ("dev_id", "device_user_id", "backup_number", "fingerprint_id", "origin", "state", "last_seen_at", "updated_at")
SELECT f."source_dev_id", e."device_user_id", f."source_backup_number", f."id", 'physical', 'present', f."updated_at", now()
  FROM "employee_fingerprint" f
  JOIN "employee_device_enrollment" e
    ON e."employee_id" = f."employee_id" AND e."dev_id" = f."source_dev_id" AND e."status" = 'active'
 WHERE f."source_dev_id" IS NOT NULL AND f."source_backup_number" IS NOT NULL
ON CONFLICT ("dev_id", "device_user_id", "backup_number") DO NOTHING;

-- === 3. sync_run / sync_hold ===
CREATE TABLE "sync_run" (
    "id" SERIAL NOT NULL,
    "kind" "sync_kind" NOT NULL,
    "trigger" "sync_trigger" NOT NULL,
    "dev_id" TEXT,
    "op_id" INTEGER,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "ok" BOOLEAN,
    "stats" JSONB,
    "actor_app_user_id" INTEGER,

    CONSTRAINT "sync_run_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_run_dev_id_kind_started_at_idx" ON "sync_run"("dev_id", "kind", "started_at" DESC);
ALTER TABLE "sync_run" ADD CONSTRAINT "sync_run_dev_id_fkey"
  FOREIGN KEY ("dev_id") REFERENCES "devices"("dev_id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "sync_hold" (
    "id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "planned_removals" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" INTEGER,
    "resolution" "sync_hold_resolution",

    CONSTRAINT "sync_hold_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sync_hold_dev_id_resolved_at_idx" ON "sync_hold"("dev_id", "resolved_at");
ALTER TABLE "sync_hold" ADD CONSTRAINT "sync_hold_dev_id_fkey"
  FOREIGN KEY ("dev_id") REFERENCES "devices"("dev_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- === 4. prioridad en la cola ===
ALTER TABLE "commands" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;
CREATE INDEX "commands_dev_id_status_priority_created_at_idx"
  ON "commands"("dev_id", "status", "priority", "created_at");
ALTER TABLE "operations" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;
