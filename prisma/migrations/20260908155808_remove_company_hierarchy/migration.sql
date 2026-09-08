-- Se descarta la jerarquía padre/hijas entre empresas (2026-09-08): en la
-- práctica todos los clientes de ALCO son una sola razón social con varias
-- sedes (`site`), no varias empresas distintas compartiendo empleados. La
-- única empresa real cargada (FARMACIA FARMALIDO) ya estaba modelada así:
-- una fila con dos `site` (Este/Oeste), sin hijas — is_group/shared_employees
-- no tenían efecto real, solo quedaban prendidos sin uso.

DROP TRIGGER IF EXISTS "client_company_two_levels" ON "client_company";
DROP FUNCTION IF EXISTS client_company_enforce_two_levels();

ALTER TABLE "client_company" DROP CONSTRAINT IF EXISTS "client_company_tax_id_required_for_leaf";
ALTER TABLE "client_company" DROP CONSTRAINT IF EXISTS "client_company_parent_id_fkey";
DROP INDEX IF EXISTS "client_company_parent_id_idx";

ALTER TABLE "client_company"
  DROP COLUMN IF EXISTS "parent_id",
  DROP COLUMN IF EXISTS "is_group",
  DROP COLUMN IF EXISTS "shared_employees";
