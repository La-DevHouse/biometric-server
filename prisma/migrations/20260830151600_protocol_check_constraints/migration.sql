-- CHECK constraints que Prisma no expresa en el schema (ver docs/08-data-model.md §6).
-- Portean los `CHECK (... IN (...))` que estas columnas tenían en SQLite
-- (lib/db.ts BASE_SCHEMA_SQL).

ALTER TABLE "commands"
  ADD CONSTRAINT "commands_status_check"
  CHECK (status IN ('WAIT', 'RUN', 'RESULT', 'ERROR'));

ALTER TABLE "operations"
  ADD CONSTRAINT "operations_stage_check"
  CHECK (stage IN ('queued', 'sent', 'waiting', 'verifying',
                   'done', 'mismatch', 'error', 'canceled'));

ALTER TABLE "raw_traffic"
  ADD CONSTRAINT "raw_traffic_direction_check"
  CHECK (direction IN ('in', 'out'));
