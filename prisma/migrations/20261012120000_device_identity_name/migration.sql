-- Identidad de equipos con dev_id placeholder (docs/04 → "dev_id placeholder").
--
-- 1. `name`: nombre visible en el panel. Hasta ahora se usaba fk_name, que vive
--    en el equipo; desde acá fk_name queda solo lectura (en equipos normales el
--    servidor lo reescribe con el serial; en los faciales ES la identidad).
-- 2. `reported_dev_id`: el dev_id tal como lo manda el header.
-- 3. Los equipos registrados bajo el placeholder 000000000001 pasan a su
--    fk_name (el serial). Las tablas con FK a devices.dev_id cascadean solas
--    (ON UPDATE CASCADE); las que guardan dev_id como texto se mueven a mano.
--    Lo que esté bajo 000000000001 puede venir de varios equipos físicos (era
--    justamente el problema): queda todo en el que tenga hoy ese fk_name.

ALTER TABLE "devices" ADD COLUMN "name" TEXT;
ALTER TABLE "devices" ADD COLUMN "reported_dev_id" TEXT;

UPDATE "devices" SET "reported_dev_id" = "dev_id";

-- Equipos normales: el fk_name actual era el nombre que alguien le puso.
UPDATE "devices" SET "name" = NULLIF(btrim("fk_name"), '')
 WHERE "dev_id" <> '000000000001';

CREATE TEMP TABLE "_rekey" AS
SELECT d."dev_id" AS old_id, btrim(d."fk_name") AS new_id
  FROM "devices" d
 WHERE d."dev_id" = '000000000001'
   AND NULLIF(btrim(d."fk_name"), '') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "devices" x WHERE x."dev_id" = btrim(d."fk_name"));

UPDATE "commands" t        SET "dev_id" = r.new_id FROM "_rekey" r WHERE t."dev_id" = r.old_id;
UPDATE "attendance_logs" t SET "dev_id" = r.new_id FROM "_rekey" r WHERE t."dev_id" = r.old_id;
UPDATE "users" t           SET "dev_id" = r.new_id FROM "_rekey" r WHERE t."dev_id" = r.old_id;
UPDATE "enroll_data" t     SET "dev_id" = r.new_id FROM "_rekey" r WHERE t."dev_id" = r.old_id;
UPDATE "block_buffer" t    SET "dev_id" = r.new_id FROM "_rekey" r WHERE t."dev_id" = r.old_id;
UPDATE "operations" t      SET "dev_id" = r.new_id FROM "_rekey" r WHERE t."dev_id" = r.old_id;
-- raw_traffic se deja con el dev_id del cable: es la bitácora de lo que llegó.

UPDATE "devices" d SET "dev_id" = r.new_id, "fk_name" = r.new_id
  FROM "_rekey" r WHERE d."dev_id" = r.old_id;
DROP TABLE "_rekey";
