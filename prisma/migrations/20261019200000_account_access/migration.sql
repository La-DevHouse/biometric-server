-- Perfiles de acceso (docs/18): el rol dice qué puede hacer y el alcance a qué
-- empresas.
--   admin    = Administrador: todo, todas las empresas (las cuentas de siempre).
--   viewer   = Solo lectura: ve y descarga; todas las empresas o solo algunas.
--   operator = Socio: trabaja (edita) solo con ciertas empresas; no edita huellas.
-- all_companies = false → solo las empresas de app_user_company.
ALTER TABLE "app_user" ADD COLUMN "all_companies" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_admin_all_companies" CHECK (role <> 'admin' OR all_companies);
ALTER TABLE "app_user" ADD CONSTRAINT "app_user_operator_limited" CHECK (role <> 'operator' OR NOT all_companies);

CREATE TABLE "app_user_company" (
    "app_user_id" INTEGER NOT NULL,
    "company_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_user_company_pkey" PRIMARY KEY ("app_user_id", "company_id")
);
CREATE INDEX "app_user_company_company_id_idx" ON "app_user_company"("company_id");
ALTER TABLE "app_user_company" ADD CONSTRAINT "app_user_company_app_user_id_fkey"
  FOREIGN KEY ("app_user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "app_user_company" ADD CONSTRAINT "app_user_company_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "client_company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
