-- CreateEnum
CREATE TYPE "record_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "employment_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "enrollment_status" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "attendance_status" AS ENUM ('present', 'late', 'early_leave', 'absent');

-- CreateEnum
CREATE TYPE "absence_rule" AS ENUM ('no_check_in', 'no_marks', 'under_hours');

-- CreateEnum
CREATE TYPE "export_scope" AS ENUM ('company', 'group', 'combined');

-- CreateEnum
CREATE TYPE "app_user_role" AS ENUM ('admin', 'operator', 'viewer');

-- AlterTable
ALTER TABLE "attendance_logs" ADD COLUMN     "employee_id" INTEGER,
ALTER COLUMN "received_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "block_buffer" ALTER COLUMN "received_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "commands" ALTER COLUMN "created_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint,
ALTER COLUMN "updated_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "devices" ADD COLUMN     "company_id" INTEGER,
ADD COLUMN     "device_admin_note" TEXT,
ADD COLUMN     "last_sync_at" BIGINT,
ADD COLUMN     "site_id" INTEGER,
ALTER COLUMN "created_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "enroll_data" ALTER COLUMN "updated_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "operations" ALTER COLUMN "created_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint,
ALTER COLUMN "updated_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "raw_traffic" ALTER COLUMN "created_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "updated_at" SET DEFAULT (extract(epoch from now()) * 1000)::bigint;

-- CreateTable
CREATE TABLE "client_company" (
    "id" SERIAL NOT NULL,
    "parent_id" INTEGER,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "shared_employees" BOOLEAN NOT NULL DEFAULT false,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "address" TEXT,
    "late_tolerance_min" INTEGER,
    "early_leave_tolerance_min" INTEGER,
    "absence_rule" "absence_rule",
    "absence_min_hours" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "client_company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" SERIAL NOT NULL,
    "national_id" TEXT NOT NULL,
    "tax_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "birth_date" DATE,
    "photo" BYTEA,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employment" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "site_id" INTEGER,
    "employee_group_id" INTEGER,
    "position_id" INTEGER,
    "department_id" INTEGER,
    "payroll_ref" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "status" "employment_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "department" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "department_id" INTEGER,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_group" (
    "id" SERIAL NOT NULL,
    "company_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "late_tolerance_min" INTEGER,
    "early_leave_tolerance_min" INTEGER,
    "absence_rule" "absence_rule",
    "absence_min_hours" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift" (
    "id" SERIAL NOT NULL,
    "employee_group_id" INTEGER NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "break_start" TEXT,
    "break_end" TEXT,
    "hours" DECIMAL(4,2),
    "variable_in_out" BOOLEAN NOT NULL DEFAULT false,
    "workdays" INTEGER[],
    "crosses_midnight" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_device_enrollment" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "dev_id" TEXT NOT NULL,
    "device_user_id" TEXT NOT NULL,
    "status" "enrollment_status" NOT NULL DEFAULT 'active',
    "enrolled_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_device_enrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_fingerprint" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "finger_index" INTEGER NOT NULL,
    "template" BYTEA NOT NULL,
    "source_dev_id" TEXT,
    "captured_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "employee_fingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_day" (
    "id" SERIAL NOT NULL,
    "employee_id" INTEGER NOT NULL,
    "employment_id" INTEGER,
    "date" DATE NOT NULL,
    "shift_id" INTEGER,
    "first_in" TIMESTAMPTZ(6),
    "last_out" TIMESTAMPTZ(6),
    "worked_minutes" INTEGER,
    "overtime_minutes" INTEGER,
    "status" "attendance_status",
    "computed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "attendance_day_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_correction" (
    "id" SERIAL NOT NULL,
    "attendance_day_id" INTEGER,
    "attendance_log_id" INTEGER,
    "field" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT,
    "actor_app_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "app_user_role" NOT NULL DEFAULT 'admin',
    "status" "record_status" NOT NULL DEFAULT 'active',
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_session" (
    "id" SERIAL NOT NULL,
    "token" TEXT NOT NULL,
    "app_user_id" INTEGER NOT NULL,
    "user_agent" TEXT,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" SERIAL NOT NULL,
    "actor_app_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before_json" JSONB,
    "after_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_run" (
    "id" SERIAL NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "scope" "export_scope" NOT NULL,
    "scope_company_id" INTEGER,
    "generated_by" INTEGER,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "file_ref" TEXT,
    "row_count" INTEGER,

    CONSTRAINT "export_run_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_company_parent_id_idx" ON "client_company"("parent_id");

-- CreateIndex
CREATE INDEX "site_company_id_idx" ON "site"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "site_company_id_code_key" ON "site"("company_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "employee_national_id_key" ON "employee"("national_id");

-- CreateIndex
CREATE INDEX "employee_last_name_first_name_idx" ON "employee"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "employment_employee_id_idx" ON "employment"("employee_id");

-- CreateIndex
CREATE INDEX "employment_company_id_status_idx" ON "employment"("company_id", "status");

-- CreateIndex
CREATE INDEX "employment_employee_group_id_idx" ON "employment"("employee_group_id");

-- CreateIndex
CREATE INDEX "position_department_id_idx" ON "position"("department_id");

-- CreateIndex
CREATE INDEX "employee_group_company_id_idx" ON "employee_group"("company_id");

-- CreateIndex
CREATE INDEX "shift_employee_group_id_effective_from_idx" ON "shift"("employee_group_id", "effective_from");

-- CreateIndex
CREATE INDEX "employee_device_enrollment_employee_id_idx" ON "employee_device_enrollment"("employee_id");

-- CreateIndex
CREATE INDEX "employee_device_enrollment_dev_id_device_user_id_idx" ON "employee_device_enrollment"("dev_id", "device_user_id");

-- CreateIndex
CREATE INDEX "employee_fingerprint_employee_id_idx" ON "employee_fingerprint"("employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_fingerprint_employee_id_finger_index_key" ON "employee_fingerprint"("employee_id", "finger_index");

-- CreateIndex
CREATE INDEX "attendance_day_date_idx" ON "attendance_day"("date");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_day_employee_id_date_key" ON "attendance_day"("employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_correction_attendance_day_id_idx" ON "attendance_correction"("attendance_day_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_session_token_key" ON "app_session"("token");

-- CreateIndex
CREATE INDEX "app_session_app_user_id_idx" ON "app_session"("app_user_id");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX "export_run_period_start_period_end_idx" ON "export_run"("period_start", "period_end");

-- CreateIndex
CREATE INDEX "attendance_logs_employee_id_idx" ON "attendance_logs"("employee_id");

-- CreateIndex
CREATE INDEX "devices_company_id_idx" ON "devices"("company_id");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "client_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_logs" ADD CONSTRAINT "attendance_logs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_company" ADD CONSTRAINT "client_company_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "client_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site" ADD CONSTRAINT "site_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "client_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "client_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_site_id_fkey" FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_employee_group_id_fkey" FOREIGN KEY ("employee_group_id") REFERENCES "employee_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employment" ADD CONSTRAINT "employment_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position" ADD CONSTRAINT "position_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_group" ADD CONSTRAINT "employee_group_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "client_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shift" ADD CONSTRAINT "shift_employee_group_id_fkey" FOREIGN KEY ("employee_group_id") REFERENCES "employee_group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_device_enrollment" ADD CONSTRAINT "employee_device_enrollment_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_device_enrollment" ADD CONSTRAINT "employee_device_enrollment_dev_id_fkey" FOREIGN KEY ("dev_id") REFERENCES "devices"("dev_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_fingerprint" ADD CONSTRAINT "employee_fingerprint_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_fingerprint" ADD CONSTRAINT "employee_fingerprint_source_dev_id_fkey" FOREIGN KEY ("source_dev_id") REFERENCES "devices"("dev_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_employment_id_fkey" FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_day" ADD CONSTRAINT "attendance_day_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_attendance_day_id_fkey" FOREIGN KEY ("attendance_day_id") REFERENCES "attendance_day"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_actor_app_user_id_fkey" FOREIGN KEY ("actor_app_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_session" ADD CONSTRAINT "app_session_app_user_id_fkey" FOREIGN KEY ("app_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_app_user_id_fkey" FOREIGN KEY ("actor_app_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_run" ADD CONSTRAINT "export_run_scope_company_id_fkey" FOREIGN KEY ("scope_company_id") REFERENCES "client_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_run" ADD CONSTRAINT "export_run_generated_by_fkey" FOREIGN KEY ("generated_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ===========================================================================
-- Constraints que Prisma no expresa en el schema — ver docs/08-data-model.md §6.
-- ===========================================================================

-- Jerarquía de empresas: máximo 2 niveles (padre -> hijas). CHECK no alcanza
-- (necesita subquery), va por trigger.
CREATE OR REPLACE FUNCTION client_company_enforce_two_levels()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'client_company %: no puede ser su propio padre', NEW.id;
    END IF;
    IF EXISTS (SELECT 1 FROM client_company p WHERE p.id = NEW.parent_id AND p.parent_id IS NOT NULL) THEN
      RAISE EXCEPTION 'jerarquia de empresas limitada a 2 niveles: el padre % ya es una empresa hija', NEW.parent_id;
    END IF;
    IF EXISTS (SELECT 1 FROM client_company c WHERE c.parent_id = NEW.id) THEN
      RAISE EXCEPTION 'la empresa % ya es padre de otras: no puede volverse hija', NEW.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER client_company_two_levels
  BEFORE INSERT OR UPDATE OF parent_id ON "client_company"
  FOR EACH ROW EXECUTE FUNCTION client_company_enforce_two_levels();

-- RIF requerido en empresas operativas (hoja); las entidades "grupo" pueden no tenerlo.
ALTER TABLE "client_company"
  ADD CONSTRAINT "client_company_tax_id_required_for_leaf"
  CHECK (is_group OR tax_id IS NOT NULL);

-- Un solo enrolado ACTIVO por slot de equipo.
CREATE UNIQUE INDEX "ux_enrollment_active_slot"
  ON "employee_device_enrollment" ("dev_id", "device_user_id")
  WHERE status = 'active';

-- Una corrección apunta a un attendance_day O a un attendance_log crudo, exactamente uno.
ALTER TABLE "attendance_correction"
  ADD CONSTRAINT "attendance_correction_one_target"
  CHECK ((attendance_day_id IS NULL) <> (attendance_log_id IS NULL));

-- Rangos de fecha coherentes.
ALTER TABLE "employment"
  ADD CONSTRAINT "employment_date_range"
  CHECK (end_date IS NULL OR end_date >= start_date);

ALTER TABLE "shift"
  ADD CONSTRAINT "shift_effective_range"
  CHECK (effective_to IS NULL OR effective_to >= effective_from);
