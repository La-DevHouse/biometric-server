// Huellas: copia canónica por empleado + registro de procedencia por slot de equipo
// (docs/10-reestructura-dominio-sync.md R9, §4.2). Solo DB — no importa nada de
// lib/operations, así advance.ts puede usarlo sin ciclos.
//
// Hechos de hardware en los que se apoya (docs/05, verificados 2026-09-26):
//   - el slot (backup_number 0–9) es orden de registro de UN equipo, no identidad de dedo;
//   - SET_ENROLL_DATA sobre un slot OCUPADO responde OK y no hace nada → siempre a un slot libre;
//   - SET_ENROLL_DATA NO detecta duplicados → la idempotencia sale de este registro, no del equipo;
//   - GET_USER_INFO trae la forma limpia de 612 B; el user_id va embebido en el offset 608.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { resolveBinaryRef } from "@/lib/protocol";

export const MAX_FINGERPRINTS = 10; // slots 0–9 por usuario y equipo (R10)
export const MIN_TEMPLATE_BYTES = 612;

/** Cédula sin prefijo de nacionalidad = device_user_id (docs/09 D4, docs/10 R5). */
export function cedulaDigits(nationalId: string): string {
  return nationalId.replace(/\D/g, "");
}

/** El empleado cuya cédula es este user_id del equipo, o null si no hay ninguno. */
export async function employeeByDeviceUserId(userId: string): Promise<{ id: number } | null> {
  if (!/^\d+$/.test(userId)) return null;
  const rows = await prisma.$queryRaw<{ id: number }[]>(
    Prisma.sql`SELECT id FROM employee WHERE regexp_replace(national_id, '\\D', '', 'g') = ${userId} LIMIT 1`
  );
  return rows[0] ?? null;
}

/** Mapa cédula (solo dígitos) → employee.id, para decidir en lote. */
export async function employeeIdsByCedula(): Promise<Map<string, number>> {
  const rows = await prisma.employee.findMany({ select: { id: true, national_id: true } });
  return new Map(rows.map((r) => [cedulaDigits(r.national_id), r.id]));
}

/** Vincula (dev, user_id=cédula) ↔ empleado si todavía no lo está. Automático por cédula (R5). */
export async function ensureEnrollmentLink(employeeId: number, devId: string, userId: string): Promise<void> {
  const existing = await prisma.employee_device_enrollment.findFirst({
    where: { dev_id: devId, device_user_id: userId, status: "active" },
    select: { employee_id: true },
  });
  if (existing) return;
  await prisma.employee_device_enrollment.create({
    data: { employee_id: employeeId, dev_id: devId, device_user_id: userId, status: "active" },
  });
}

interface EnrollEntry {
  backup_number: number;
  enroll_data?: unknown;
}

export interface IngestResult {
  employeeId: number | null; // null = cédula desconocida (va a la vista de desajustes, no se ingiere)
  newFingerprintIds: number[]; // huellas físicas nuevas (nunca vistas) — disparan propagación
  slots: number[]; // slots de huella que el equipo reporta para este usuario
}

/**
 * Incorpora lo que un GET_USER_INFO reporta para (devId, user_id):
 *  - vincula al empleado por cédula (si existe);
 *  - cada slot 0–9 que el registro de procedencia no conoce = huella enrolada
 *    físicamente → copia canónica nueva + slot `physical`;
 *  - un slot ya conocido (físico o propagado por nosotros) solo se marca visto —
 *    así una copia propagada nunca vuelve como "huella nueva" (evita el
 *    ida-y-vuelta entre equipos);
 *  - slots del registro que el equipo ya no reporta se borran del registro,
 *    SOLO si el equipo reportó al menos una huella (un array vacío puede ser el
 *    estado transitorio del reindexado de SET_USER_INFO — docs/05).
 */
export async function ingestUserInfo(
  devId: string,
  info: { user_id?: string; enroll_data_array?: EnrollEntry[] },
  binaries: Buffer[]
): Promise<IngestResult> {
  const userId = info.user_id ? String(info.user_id) : null;
  const entries = (info.enroll_data_array ?? []).filter((e) => e.backup_number >= 0 && e.backup_number < MAX_FINGERPRINTS);
  const slots = entries.map((e) => e.backup_number);
  if (!userId) return { employeeId: null, newFingerprintIds: [], slots };

  const employee = await employeeByDeviceUserId(userId);
  if (!employee) return { employeeId: null, newFingerprintIds: [], slots };
  await ensureEnrollmentLink(employee.id, devId, userId);

  const known = await prisma.device_fingerprint_slot.findMany({ where: { dev_id: devId, device_user_id: userId } });
  const knownBySlot = new Map(known.map((k) => [k.backup_number, k]));
  const now = new Date();
  const newFingerprintIds: number[] = [];

  for (const entry of entries) {
    const slot = knownBySlot.get(entry.backup_number);
    if (slot) {
      await prisma.device_fingerprint_slot.update({
        where: { id: slot.id },
        data: { state: "present", last_seen_at: now, last_error: null },
      });
      continue;
    }
    const template = resolveBinaryRef(entry.enroll_data, binaries);
    if (!template || template.length < MIN_TEMPLATE_BYTES) continue; // no se puede propagar algo incompleto
    const fp = await prisma.employee_fingerprint.create({
      data: {
        employee_id: employee.id,
        template: new Uint8Array(template),
        source_dev_id: devId,
        source_backup_number: entry.backup_number,
      },
    });
    await prisma.device_fingerprint_slot.create({
      data: {
        dev_id: devId,
        device_user_id: userId,
        backup_number: entry.backup_number,
        fingerprint_id: fp.id,
        origin: "physical",
        state: "present",
        last_seen_at: now,
      },
    });
    newFingerprintIds.push(fp.id);
  }

  if (entries.length > 0) {
    const reported = new Set(slots);
    const gone = known.filter((k) => !reported.has(k.backup_number)).map((k) => k.id);
    if (gone.length) await prisma.device_fingerprint_slot.deleteMany({ where: { id: { in: gone } } });
  }

  return { employeeId: employee.id, newFingerprintIds, slots };
}

/** Las huellas que deberían estar en cada equipo del alcance: las 10 activas más antiguas (R10 / O8). */
export async function desiredFingerprints(employeeId: number) {
  return prisma.employee_fingerprint.findMany({
    where: { employee_id: employeeId, status: "active" },
    orderBy: [{ captured_at: "asc" }, { id: "asc" }],
    take: MAX_FINGERPRINTS,
    select: { id: true, template: true, captured_at: true },
  });
}

/** Cuántas huellas activas tiene la persona más allá del límite de 10 (para la alerta de R10). */
export async function fingerprintOverflow(employeeId: number): Promise<number> {
  const n = await prisma.employee_fingerprint.count({ where: { employee_id: employeeId, status: "active" } });
  return Math.max(0, n - MAX_FINGERPRINTS);
}

/** Primer slot 0–9 que no está en uso, o null si están los 10 ocupados. */
export function freeSlot(used: Iterable<number>): number | null {
  const taken = new Set(used);
  for (let i = 0; i < MAX_FINGERPRINTS; i++) if (!taken.has(i)) return i;
  return null;
}

/** Slots ocupados de (dev, user) según el registro de procedencia. */
export async function usedSlots(devId: string, userId: string): Promise<number[]> {
  const rows = await prisma.device_fingerprint_slot.findMany({
    where: { dev_id: devId, device_user_id: userId },
    select: { backup_number: true },
  });
  return rows.map((r) => r.backup_number);
}

/** Registra una copia escrita por el sistema, ya verificada releyendo el equipo. */
export async function recordPropagatedSlot(
  devId: string,
  userId: string,
  backupNumber: number,
  fingerprintId: number
): Promise<void> {
  await prisma.device_fingerprint_slot.upsert({
    where: { dev_id_device_user_id_backup_number: { dev_id: devId, device_user_id: userId, backup_number: backupNumber } },
    create: {
      dev_id: devId,
      device_user_id: userId,
      backup_number: backupNumber,
      fingerprint_id: fingerprintId,
      origin: "propagated",
      state: "present",
      last_seen_at: new Date(),
    },
    update: { fingerprint_id: fingerprintId, origin: "propagated", state: "present", last_seen_at: new Date(), last_error: null },
  });
}

/** La plantilla con el user_id embebido (offset 608, uint32 LE) cambiado al del destino — docs/05. */
export function patchTemplateUserId(template: Uint8Array, userId: string): Buffer {
  const n = Number(userId);
  if (!Number.isInteger(n) || n < 0 || n > 0xffffffff) {
    throw new Error(`El ID "${userId}" no es un entero de 4 bytes — no se puede embeber en la huella.`);
  }
  const patched = Buffer.from(template);
  patched.writeUInt32LE(n, 608);
  return patched;
}
