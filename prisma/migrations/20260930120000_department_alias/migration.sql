-- Importación (docs/14): un departamento como viene en el archivo ("OPERATIVO")
-- asignado a un departamento desde la vista previa. Se recuerda para los próximos
-- archivos de cualquier empresa, igual que position_alias.
CREATE TABLE "department_alias" (
    "id" SERIAL NOT NULL,
    "alias_key" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "department_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "department_alias_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "department_alias_alias_key_key" ON "department_alias"("alias_key");
CREATE INDEX "department_alias_department_id_idx" ON "department_alias"("department_id");
ALTER TABLE "department_alias" ADD CONSTRAINT "department_alias_department_id_fkey"
    FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE CASCADE ON UPDATE CASCADE;
