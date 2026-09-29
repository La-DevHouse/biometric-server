-- Importación desde Excel (docs/14): una fila por archivo subido. Guarda el
-- archivo entre la vista previa y la confirmación (se borra a los 30 días) y el
-- resumen de lo aplicado.
CREATE TABLE "import_run" (
    "id" SERIAL NOT NULL,
    "actor_app_user_id" INTEGER,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "file" BYTEA,
    "template_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "plan_hash" TEXT,
    "summary" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "import_run_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "import_run_status_check" CHECK ("status" IN ('preview', 'applied', 'failed', 'expired'))
);

CREATE INDEX "import_run_created_at_idx" ON "import_run"("created_at" DESC);

ALTER TABLE "import_run" ADD CONSTRAINT "import_run_actor_app_user_id_fkey"
    FOREIGN KEY ("actor_app_user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
