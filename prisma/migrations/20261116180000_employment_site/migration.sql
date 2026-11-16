-- Sede del contrato (2026-11-16, pedido de Ezequiel). Revierte en parte docs/10 R4:
-- vuelve a existir employment.site_id, pero SOLO INFORMATIVA. El alcance de la
-- huella sigue saliendo de la empresa del contrato (todas sus sedes, y su grupo),
-- no de esta columna. Obligatoria en la app cuando la empresa tiene varias sedes
-- activas; con una sola se asigna sola.
ALTER TABLE "employment" ADD COLUMN "site_id" INTEGER;
ALTER TABLE "employment" ADD CONSTRAINT "employment_site_id_fkey"
  FOREIGN KEY ("site_id") REFERENCES "site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "employment_site_id_idx" ON "employment"("site_id");

-- Contratos que ya existen: si su empresa tiene UNA sola sede activa, esa es la suya.
-- Los de empresas con varias sedes quedan sin sede hasta que alguien los edite.
UPDATE "employment" em
   SET "site_id" = s.id
  FROM "site" s
 WHERE s.company_id = em.company_id
   AND s.status = 'active'
   AND em.site_id IS NULL
   AND (SELECT count(*) FROM "site" o WHERE o.company_id = em.company_id AND o.status = 'active') = 1;
