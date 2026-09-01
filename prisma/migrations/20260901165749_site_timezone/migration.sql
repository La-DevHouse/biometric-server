-- Zona horaria IANA de la sede: hora local para interpretar marcajes y para
-- el SET_TIME que se manda al equipo. Default Venezuela.
ALTER TABLE "site" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Caracas';
