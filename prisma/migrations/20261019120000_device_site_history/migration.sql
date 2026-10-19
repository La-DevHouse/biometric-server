-- Historial de sede por equipo (docs/11 O-UI6): una marcación cuenta para la sede
-- (y la empresa) donde estaba el equipo EN ESE MOMENTO, no para la actual. Mover un
-- equipo de empresa ya no le lleva las marcaciones viejas a la nueva.
--
-- Lo mantiene un trigger sobre devices.site_id, así ningún camino (panel, scripts,
-- tests) puede saltárselo:
--   * primera sede de un equipo que nunca tuvo: período "desde siempre"
--     (started_at NULL) — lo marcado mientras estaba "pendiente de asignar" queda
--     para la primera empresa, como hasta ahora;
--   * cambio de sede: se cierra el período abierto (ended_at = ahora) y se abre
--     otro desde ahora;
--   * sin sede: solo se cierra; lo que marque sin sede no es de ninguna empresa.

CREATE TABLE "device_site_assignment" (
    "id" SERIAL NOT NULL,
    "dev_id" TEXT NOT NULL,
    "site_id" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6),
    "ended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_site_assignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "device_site_assignment_dev_id_idx" ON "device_site_assignment"("dev_id");
CREATE INDEX "device_site_assignment_site_id_idx" ON "device_site_assignment"("site_id");

ALTER TABLE "device_site_assignment" ADD CONSTRAINT "device_site_assignment_dev_id_fkey"
  FOREIGN KEY ("dev_id") REFERENCES "devices"("dev_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "device_site_assignment" ADD CONSTRAINT "device_site_assignment_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Equipos que hoy tienen sede: período "desde siempre" en la actual (nada cambia
-- para lo ya registrado; el historial cuenta desde el próximo movimiento).
INSERT INTO "device_site_assignment" ("dev_id", "site_id", "started_at", "ended_at")
SELECT "dev_id", "site_id", NULL, NULL FROM "devices" WHERE "site_id" IS NOT NULL;

CREATE OR REPLACE FUNCTION device_site_history() RETURNS trigger AS $$
DECLARE
  had_history BOOLEAN;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.site_id IS NOT DISTINCT FROM OLD.site_id THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM device_site_assignment WHERE dev_id = NEW.dev_id) INTO had_history;
  UPDATE device_site_assignment SET ended_at = now()
   WHERE dev_id = NEW.dev_id AND ended_at IS NULL;
  IF NEW.site_id IS NOT NULL THEN
    INSERT INTO device_site_assignment (dev_id, site_id, started_at)
    VALUES (NEW.dev_id, NEW.site_id, CASE WHEN had_history THEN now() ELSE NULL END);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER device_site_history
AFTER INSERT OR UPDATE OF site_id ON "devices"
FOR EACH ROW EXECUTE FUNCTION device_site_history();
