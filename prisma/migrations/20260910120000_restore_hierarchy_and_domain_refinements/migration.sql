-- Reunión 3 con Ezequiel (ver docs/09-reunion-3.md §7.1 ítem 8, §3.1, §3.5.1).
--
-- 1. Restaura la jerarquía padre/hijas de `client_company` (revertida por error
--    el 2026-09-08 en 20260908155808_remove_company_hierarchy): ALCO sí maneja
--    grupos de empresas con RIF distinto que comparten empleados.
-- 2. `shared_employees` vuelve, ahora con DEFAULT true (vive en la fila del grupo;
--    dispara el fan-out de enrolamiento a todos los devices del grupo).
-- 3. Nuevo `business_model` (tipo de comercio) + M:N con `position` — reemplaza
--    el "Departamento de Nómina" de Adempiere; filtra el catálogo de cargos.
-- 4. `employment.payroll_type` (quincenal | semanal).
-- 5. `client_company`: `logo` + representante legal (nombre / cédula / teléfono).
-- 6. `devices.company_linked_at` — cuándo se asoció el equipo a su empresa/sede.

-- === enums ===
CREATE TYPE "payroll_type" AS ENUM ('quincenal', 'semanal');

-- === business_model + M:N con position ===
CREATE TABLE "business_model" (
    "id" SERIAL NOT NULL,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "business_model_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "position_business_model" (
    "position_id" INTEGER NOT NULL,
    "business_model_id" INTEGER NOT NULL,

    CONSTRAINT "position_business_model_pkey" PRIMARY KEY ("position_id", "business_model_id")
);

CREATE INDEX "position_business_model_business_model_id_idx" ON "position_business_model"("business_model_id");

-- === client_company: restaurar jerarquía + campos nuevos ===
ALTER TABLE "client_company" ADD COLUMN "parent_id" INTEGER;
ALTER TABLE "client_company" ADD COLUMN "is_group" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "client_company" ADD COLUMN "shared_employees" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "client_company" ADD COLUMN "business_model_id" INTEGER;
ALTER TABLE "client_company" ADD COLUMN "logo" BYTEA;
ALTER TABLE "client_company" ADD COLUMN "legal_rep_name" TEXT;
ALTER TABLE "client_company" ADD COLUMN "legal_rep_national_id" TEXT;
ALTER TABLE "client_company" ADD COLUMN "legal_rep_phone" TEXT;

CREATE INDEX "client_company_parent_id_idx" ON "client_company"("parent_id");
CREATE INDEX "client_company_business_model_id_idx" ON "client_company"("business_model_id");

-- === employment: tipo de nómina ===
ALTER TABLE "employment" ADD COLUMN "payroll_type" "payroll_type";

-- === devices: timestamp de asociación a empresa/sede ===
ALTER TABLE "devices" ADD COLUMN "company_linked_at" TIMESTAMPTZ(6);

-- === foreign keys ===
ALTER TABLE "client_company" ADD CONSTRAINT "client_company_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "client_company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "client_company" ADD CONSTRAINT "client_company_business_model_id_fkey" FOREIGN KEY ("business_model_id") REFERENCES "business_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "position_business_model" ADD CONSTRAINT "position_business_model_position_id_fkey" FOREIGN KEY ("position_id") REFERENCES "position"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "position_business_model" ADD CONSTRAINT "position_business_model_business_model_id_fkey" FOREIGN KEY ("business_model_id") REFERENCES "business_model"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Constraints que Prisma no expresa — ver docs/08-data-model.md §6.
-- Idénticos a 20260831211102_domain (revertidos el 2026-09-08).
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
