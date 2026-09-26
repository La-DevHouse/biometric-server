-- Reestructura de dominio post-Reunión 3 (plan.md → docs/10-reestructura-dominio-sync.md, PR 1).
--
-- 1. Grupo de empresas = tabla propia `company_group` (name, shared_employees).
--    Reemplaza la jerarquía client_company.parent_id / is_group / shared_employees
--    (20260910120000). El grupo NO tiene sedes, dispositivos ni contratos.
-- 2. Empresa 1 — 1..N Sede: toda empresa activa tiene al menos una sede activa
--    (constraint trigger diferido → se crean empresa + sede en la misma transacción).
-- 3. Dispositivo → solo sede (se elimina devices.company_id; la empresa sale de la sede).
-- 4. Contrato (employment) sin sede (se elimina employment.site_id).
--
-- Backfill en el mismo archivo, ANTES de borrar columnas. Preserva los horarios
-- (schedule_group, con ON DELETE CASCADE hacia la empresa): una fila "grupo" que
-- tenga cualquier cosa colgando NO se borra — queda como empresa miembro de su
-- propio grupo. Solo se borran filas-grupo vacías. Nada de esto toca equipos físicos.
-- Irreversible en cuanto a la forma vieja de la jerarquía (parent_id/is_group).

-- === 1. company_group ===
CREATE TABLE "company_group" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "shared_employees" BOOLEAN NOT NULL DEFAULT true,
    "status" "record_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    -- solo para el backfill; se borra al final de esta migración
    "legacy_company_id" INTEGER,

    CONSTRAINT "company_group_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "client_company" ADD COLUMN "group_id" INTEGER;
CREATE INDEX "client_company_group_id_idx" ON "client_company"("group_id");
ALTER TABLE "client_company" ADD CONSTRAINT "client_company_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "company_group"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- === 2. Backfill de grupos ===
-- Origen de un grupo: toda fila marcada is_group, y también cualquier empresa que
-- ya sea padre de otras aunque no esté marcada (el trigger viejo lo permitía).
INSERT INTO "company_group" ("name", "shared_employees", "status", "created_at", "updated_at", "legacy_company_id")
SELECT c."name", c."shared_employees", c."status", c."created_at", now(), c."id"
  FROM "client_company" c
 WHERE c."is_group"
    OR EXISTS (SELECT 1 FROM "client_company" h WHERE h."parent_id" = c."id");

-- Las hijas pasan al grupo creado a partir de su padre.
UPDATE "client_company" c
   SET "group_id" = g."id"
  FROM "company_group" g
 WHERE c."parent_id" = g."legacy_company_id";

-- La fila de origen, si queda como empresa, es miembro de su propio grupo. Queda si:
--   * NO era is_group (era una empresa operativa que además era padre), o
--   * era is_group pero tiene algo colgando (sedes, horarios, contratos, equipos, exports).
UPDATE "client_company" c
   SET "group_id" = g."id"
  FROM "company_group" g
 WHERE g."legacy_company_id" = c."id"
   AND (
         NOT c."is_group"
      OR EXISTS (SELECT 1 FROM "site" s           WHERE s."company_id" = c."id")
      OR EXISTS (SELECT 1 FROM "schedule_group" x WHERE x."company_id" = c."id")
      OR EXISTS (SELECT 1 FROM "employment" e     WHERE e."company_id" = c."id")
      OR EXISTS (SELECT 1 FROM "devices" d        WHERE d."company_id" = c."id")
      OR EXISTS (SELECT 1 FROM "export_run" r     WHERE r."scope_company_id" = c."id")
   );

-- Filas-grupo vacías: ya no representan nada (el grupo vive en company_group).
-- Primero se desenganchan sus hijas (parent_id tiene ON DELETE RESTRICT).
UPDATE "client_company" SET "parent_id" = NULL WHERE "parent_id" IS NOT NULL;
DELETE FROM "client_company" c
 WHERE c."is_group" AND c."group_id" IS NULL;

ALTER TABLE "company_group" DROP COLUMN "legacy_company_id";

-- === 3. Backfill de sedes: toda empresa sin sede activa recibe "Principal" ===
INSERT INTO "site" ("company_id", "name", "updated_at")
SELECT c."id", 'Principal', now()
  FROM "client_company" c
 WHERE NOT EXISTS (SELECT 1 FROM "site" s WHERE s."company_id" = c."id" AND s."status" = 'active');

-- Equipos asignados a una empresa pero sin sede → la primera sede activa de esa empresa.
UPDATE "devices" d
   SET "site_id" = (
         SELECT s."id" FROM "site" s
          WHERE s."company_id" = d."company_id" AND s."status" = 'active'
          ORDER BY s."id" LIMIT 1)
 WHERE d."site_id" IS NULL AND d."company_id" IS NOT NULL;

-- === 4. Retiro de la jerarquía vieja ===
DROP TRIGGER IF EXISTS "client_company_two_levels" ON "client_company";
DROP FUNCTION IF EXISTS client_company_enforce_two_levels();
ALTER TABLE "client_company" DROP CONSTRAINT IF EXISTS "client_company_tax_id_required_for_leaf";
ALTER TABLE "client_company" DROP CONSTRAINT "client_company_parent_id_fkey";
DROP INDEX "client_company_parent_id_idx";
ALTER TABLE "client_company" DROP COLUMN "parent_id",
                             DROP COLUMN "is_group",
                             DROP COLUMN "shared_employees";

-- === 5. Dispositivo → solo sede ===
ALTER TABLE "devices" DROP CONSTRAINT "devices_company_id_fkey";
DROP INDEX "devices_company_id_idx";
ALTER TABLE "devices" DROP COLUMN "company_id";
CREATE INDEX "devices_site_id_idx" ON "devices"("site_id");

-- === 6. Contrato sin sede ===
ALTER TABLE "employment" DROP CONSTRAINT "employment_site_id_fkey";
ALTER TABLE "employment" DROP COLUMN "site_id";

-- ===========================================================================
-- Constraint que Prisma no expresa: empresa activa ⇒ al menos una sede activa.
-- Constraint trigger DEFERRABLE INITIALLY DEFERRED: se evalúa al COMMIT, así que
-- crear empresa + sede en la misma transacción pasa; desactivar/borrar/mover la
-- última sede activa de una empresa activa, o reactivar una empresa sin sede
-- activa, falla. Ver docs/10 §3.4.
-- ===========================================================================
CREATE OR REPLACE FUNCTION company_has_active_site(cid INTEGER)
RETURNS VOID AS $$
BEGIN
  IF cid IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM client_company c WHERE c.id = cid AND c.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM site s WHERE s.company_id = cid AND s.status = 'active') THEN
    RAISE EXCEPTION 'la empresa % debe tener al menos una sede activa', cid
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION client_company_requires_active_site()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM company_has_active_site(NEW.id);
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION site_keeps_company_active_site()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    PERFORM company_has_active_site(OLD.company_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (TG_OP = 'INSERT' OR NEW.company_id IS DISTINCT FROM OLD.company_id) THEN
    PERFORM company_has_active_site(NEW.company_id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "client_company_requires_active_site"
  AFTER INSERT OR UPDATE OF status ON "client_company"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION client_company_requires_active_site();

CREATE CONSTRAINT TRIGGER "site_keeps_company_active_site"
  AFTER UPDATE OF status, company_id OR DELETE ON "site"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION site_keeps_company_active_site();
