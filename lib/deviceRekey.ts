// Cambiar la identidad (devices.dev_id) de un equipo, con todo lo suyo.
//
// Caso: un facial con dev_id placeholder se identifica por su fk_name
// (lib/deviceIdentity), y algunos llegan con un nombre de fábrica ("FK_DEV",
// visto 2026-10-18) en vez del serial. Desde el panel se le escribe el serial de
// la caja con SET_FK_NAME; cuando el equipo lo confirma, su registro pasa del
// nombre viejo al serial (protocol-handlers). Mismas tablas que la migración
// 20261012120000_device_identity_name: las que tienen FK a devices.dev_id
// cascadean solas (ON UPDATE CASCADE); las que guardan dev_id como texto se
// mueven a mano. raw_traffic queda como llegó por el cable.
import { prisma } from "@/lib/db";

const SOFT_TABLES = ["commands", "attendance_logs", "users", "enroll_data", "block_buffer", "operations"] as const;

/** Serial aceptable para escribir en el nombre del equipo: letras, dígitos y guiones. */
export const SERIAL_PATTERN = /^[A-Za-z0-9-]{4,24}$/;

/**
 * Mueve el equipo `oldId` a `newId`. No hace nada (y devuelve false) si `newId`
 * ya es otro equipo: no se mezclan dos registros.
 */
export async function rekeyDevice(oldId: string, newId: string): Promise<boolean> {
  if (oldId === newId) return false;
  return prisma.$transaction(async (tx) => {
    const taken = await tx.devices.findUnique({ where: { dev_id: newId }, select: { dev_id: true } });
    if (taken) return false;
    const exists = await tx.devices.findUnique({ where: { dev_id: oldId }, select: { dev_id: true } });
    if (!exists) return false;
    for (const t of SOFT_TABLES) {
      await tx.$executeRawUnsafe(`UPDATE "${t}" SET "dev_id" = $1 WHERE "dev_id" = $2`, newId, oldId);
    }
    await tx.devices.update({ where: { dev_id: oldId }, data: { dev_id: newId, fk_name: newId } });
    return true;
  });
}
