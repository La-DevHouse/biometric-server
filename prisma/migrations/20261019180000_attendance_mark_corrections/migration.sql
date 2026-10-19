-- Correcciones manuales de marcaciones (docs/16, Hito 4 paso 4). Reemplaza la
-- tabla attendance_correction original (por campo de un attendance_day, nunca
-- usada, vacía en todas las bases): los días se borran y rehacen en cada
-- recálculo, así que una corrección colgada del día se perdería. Ahora se corrige
-- la ENTRADA del cálculo — las marcaciones — y nunca attendance_logs:
--   add_mark  = una marcación que falta (hora de pared de la sede + sede);
--   void_mark = anular una marcación del equipo (attendance_logs.id).
-- Motivo obligatorio, quién y cuándo; deshacer deja quién y cuándo (no se borra).
DROP TABLE "attendance_correction";

CREATE TYPE "attendance_correction_kind" AS ENUM ('add_mark', 'void_mark');

CREATE TABLE "attendance_correction" (
    "id" SERIAL NOT NULL,
    "employment_id" INTEGER NOT NULL,
    "kind" "attendance_correction_kind" NOT NULL,
    "io_time" TEXT,
    "site_id" INTEGER,
    "attendance_log_id" INTEGER,
    "reason" TEXT NOT NULL,
    "actor_app_user_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(6),
    "revoked_by_app_user_id" INTEGER,

    CONSTRAINT "attendance_correction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_correction_shape" CHECK (
      (kind = 'add_mark' AND io_time ~ '^[0-9]{14}$' AND site_id IS NOT NULL AND attendance_log_id IS NULL)
      OR (kind = 'void_mark' AND attendance_log_id IS NOT NULL AND io_time IS NULL AND site_id IS NULL)),
    CONSTRAINT "attendance_correction_reason" CHECK (length(btrim(reason)) > 0),
    CONSTRAINT "attendance_correction_revoked" CHECK ((revoked_at IS NULL) = (revoked_by_app_user_id IS NULL))
);

CREATE INDEX "attendance_correction_employment_id_idx" ON "attendance_correction"("employment_id");
CREATE INDEX "attendance_correction_site_id_io_time_idx" ON "attendance_correction"("site_id", "io_time");
-- Una marcación del equipo se anula una sola vez (mientras la anulación esté vigente).
CREATE UNIQUE INDEX "attendance_correction_void_once" ON "attendance_correction"("attendance_log_id")
  WHERE kind = 'void_mark' AND revoked_at IS NULL;

ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_employment_id_fkey"
  FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_actor_app_user_id_fkey"
  FOREIGN KEY ("actor_app_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_correction" ADD CONSTRAINT "attendance_correction_revoked_by_app_user_id_fkey"
  FOREIGN KEY ("revoked_by_app_user_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
