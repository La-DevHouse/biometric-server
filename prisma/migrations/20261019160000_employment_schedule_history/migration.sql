-- Historial de horario por contrato (docs/16): el horario de un día es el último
-- que empezó en o antes de ese día. Antes del primero, el contrato no tiene
-- horario (solo horas) — así asignar un horario hoy no vuelve ausencias los días
-- pasados. schedule_group_id NULL = "sin horario desde esa fecha".
CREATE TABLE "employment_schedule" (
    "id" SERIAL NOT NULL,
    "employment_id" INTEGER NOT NULL,
    "schedule_group_id" INTEGER,
    "starts_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employment_schedule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employment_schedule_employment_id_starts_on_idx" ON "employment_schedule"("employment_id", "starts_on");
CREATE INDEX "employment_schedule_schedule_group_id_idx" ON "employment_schedule"("schedule_group_id");

ALTER TABLE "employment_schedule" ADD CONSTRAINT "employment_schedule_employment_id_fkey"
  FOREIGN KEY ("employment_id") REFERENCES "employment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employment_schedule" ADD CONSTRAINT "employment_schedule_schedule_group_id_fkey"
  FOREIGN KEY ("schedule_group_id") REFERENCES "schedule_group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Los contratos que ya tienen horario lo tienen desde su inicio (nada cambia).
INSERT INTO "employment_schedule" ("employment_id", "schedule_group_id", "starts_on")
SELECT "id", "schedule_group_id", "start_date" FROM "employment" WHERE "schedule_group_id" IS NOT NULL;

-- Cualquier camino que cambie employment.schedule_group_id deja historial:
--   * contrato nuevo con horario: desde su fecha de inicio;
--   * cambio de la fecha de inicio: el horario que regía al inicio se mueve con ella;
--   * cambio de horario: desde hoy (Caracas), salvo que la app ya haya registrado
--     ese cambio con su propia fecha (asignación en masa con "Vigente desde").
CREATE OR REPLACE FUNCTION employment_schedule_history() RETURNS trigger AS $$
DECLARE
  latest_group INTEGER;
  has_rows BOOLEAN;
  d DATE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.schedule_group_id IS NOT NULL THEN
      INSERT INTO employment_schedule (employment_id, schedule_group_id, starts_on)
      VALUES (NEW.id, NEW.schedule_group_id, NEW.start_date);
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.start_date < OLD.start_date THEN
    UPDATE employment_schedule SET starts_on = NEW.start_date
     WHERE employment_id = NEW.id AND starts_on = OLD.start_date;
  ELSIF NEW.start_date > OLD.start_date THEN
    -- El que regía en la fecha nueva pasa a empezar ahí; los anteriores sobran.
    UPDATE employment_schedule SET starts_on = NEW.start_date
     WHERE id = (SELECT id FROM employment_schedule
                  WHERE employment_id = NEW.id AND starts_on <= NEW.start_date
                  ORDER BY starts_on DESC, id DESC LIMIT 1);
    DELETE FROM employment_schedule WHERE employment_id = NEW.id AND starts_on < NEW.start_date;
  END IF;
  IF NEW.schedule_group_id IS NOT DISTINCT FROM OLD.schedule_group_id THEN
    RETURN NEW;
  END IF;
  SELECT schedule_group_id, TRUE INTO latest_group, has_rows
    FROM employment_schedule WHERE employment_id = NEW.id
   ORDER BY starts_on DESC, id DESC LIMIT 1;
  IF has_rows AND latest_group IS NOT DISTINCT FROM NEW.schedule_group_id THEN
    RETURN NEW; -- la app ya lo registró con su fecha
  END IF;
  d := GREATEST((now() AT TIME ZONE 'America/Caracas')::date, NEW.start_date);
  DELETE FROM employment_schedule WHERE employment_id = NEW.id AND starts_on >= d;
  INSERT INTO employment_schedule (employment_id, schedule_group_id, starts_on)
  VALUES (NEW.id, NEW.schedule_group_id, d);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employment_schedule_history
AFTER INSERT OR UPDATE OF schedule_group_id, start_date ON "employment"
FOR EACH ROW EXECUTE FUNCTION employment_schedule_history();
