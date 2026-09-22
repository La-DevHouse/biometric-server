-- Foto de la cédula subida para autocompletar (docs/09-reunion-3.md §3.10).
-- Decisión explícita del cliente: se conserva luego de extraer los datos
-- (no se descarta como el PDF/foto del RIF, que solo se parsean al vuelo).
ALTER TABLE "employee" ADD COLUMN "cedula_photo" BYTEA;
