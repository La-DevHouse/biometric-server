-- Reintentos de comandos que los faciales rechazan al azar con "Error"
-- (GET_USER_INFO, SET_ENROLL_DATA — docs/05 → "Faciales: Error intermitente").
ALTER TABLE "commands" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;
