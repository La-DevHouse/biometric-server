-- Importación de empleados por empresa desde el export de Galepso (docs/14).
--
-- position_alias: un cargo como viene en el archivo ("DESPACHADORA", "HORMERO")
-- asignado a un puesto existente desde la vista previa. Se recuerda para los
-- próximos archivos de cualquier empresa. `alias_key` es la clave normalizada
-- (minúsculas, sin acentos ni puntuación).
CREATE TABLE "position_alias" (
    "id" SERIAL NOT NULL,
    "alias_key" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "position_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "position_alias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "position_alias_alias_key_key" ON "position_alias"("alias_key");
CREATE INDEX "position_alias_position_id_idx" ON "position_alias"("position_id");
ALTER TABLE "position_alias" ADD CONSTRAINT "position_alias_position_id_fkey"
    FOREIGN KEY ("position_id") REFERENCES "position"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cada importación es de una empresa.
ALTER TABLE "import_run" ADD COLUMN "company_id" INTEGER;
CREATE INDEX "import_run_company_id_idx" ON "import_run"("company_id");
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "client_company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
