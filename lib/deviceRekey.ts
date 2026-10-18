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
import { prisma, getAsync } from "@/lib/db";
import { isPlaceholderDevId } from "@/lib/deviceIdentity";

/** Un serial real de estos equipos: solo dígitos, 8 a 16 (ej. 2401058627). */
export const LOOKS_LIKE_SERIAL = /^\d{8,16}$/;

/**
 * Consultas por minuto con un mismo nombre por encima de esto = más de un equipo
 * físico detrás (cada uno consulta cada ~10 s → ~6 por minuto).
 */
const SHARED_POLLS_PER_MINUTE = 9;

export type SerialCorrectionReason = "not_serial" | "shared";

/**
 * ¿Hace falta corregir el serial de este equipo? Solo para faciales que se
 * identifican por su nombre (lib/deviceIdentity), y solo si ese nombre no parece
 * un serial ("not_serial", ej. FK_DEV) o hay más de un equipo consultando con él
 * ("shared"). Con un serial de verdad y sin choque, no se puede cambiar: null.
 */
export async function serialCorrectionReason(devId: string): Promise<SerialCorrectionReason | null> {
  const device = await prisma.devices.findUnique({ where: { dev_id: devId }, select: { reported_dev_id: true } });
  if (!device || !isPlaceholderDevId(device.reported_dev_id)) return null;
  if (!LOOKS_LIKE_SERIAL.test(devId)) return "not_serial";
  const polls = await getAsync<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM raw_traffic
      WHERE direction = 'out' AND request_code = 'receive_cmd' AND dev_id = ?
        AND created_at > (extract(epoch from now()) * 1000)::bigint - 60000`,
    [devId]
  );
  return Number(polls?.n ?? 0) > SHARED_POLLS_PER_MINUTE ? "shared" : null;
}

const SOFT_TABLES = ["commands", "attendance_logs", "users", "enroll_data", "block_buffer", "operations"] as const;

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
