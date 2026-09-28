-- Foto de la cédula del representante legal de la empresa (se escanea en el
-- form de empresa para precargar nombre y cédula, y se conserva — mismo criterio
-- que employee.cedula_photo, docs/09 §3.10).
ALTER TABLE "client_company" ADD COLUMN "legal_rep_cedula_photo" BYTEA;
