// ingestCachedFingerprints (lib/fingerprints.ts): huellas ya leídas en la caché del
// equipo, de usuarios que son la cédula de un empleado, se asignan sin volver a
// preguntarle al equipo (caso real: equipo 2023054246, 2026-10-18).
import { test, after } from "node:test";
import { strict as assert } from "node:assert";

{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const fp = require("../lib/fingerprints") as typeof import("../lib/fingerprints");
const { prisma } = db;

const DEV = `ING${Date.now()}`;
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
const CED = `6${SEED}1`;
const employees: number[] = [];

after(async () => {
  await prisma.employee_fingerprint.deleteMany({ where: { employee_id: { in: employees } } });
  await prisma.employee_device_enrollment.deleteMany({ where: { dev_id: DEV } });
  await db.runAsync(`DELETE FROM enroll_data WHERE dev_id = ?`, [DEV]);
  await prisma.devices.deleteMany({ where: { dev_id: DEV } });
  await prisma.employee.deleteMany({ where: { id: { in: employees } } });
  await prisma.$disconnect();
});

const cache = (userId: string, slot: number, bytes: number) =>
  db.runAsync(`INSERT INTO enroll_data (dev_id, user_id, backup_number, data) VALUES (?, ?, ?, ?)`, [
    DEV,
    userId,
    slot,
    Buffer.alloc(bytes, slot + 1),
  ]);

test("asigna desde la caché las huellas de empleados sin registro de procedencia, una sola vez", async () => {
  await prisma.devices.create({ data: { dev_id: DEV } });
  const e = await prisma.employee.create({ data: { national_id: `V-${CED}`, first_name: "T", last_name: "Ingest" } });
  employees.push(e.id);

  await cache(CED, 0, 612); // empleado, forma limpia
  await cache(CED, 1, 612);
  await cache("4471", 0, 612); // ID que no es de nadie → se ignora
  await cache(`7${SEED}9`, 0, 524); // forma contaminada (GET_ENROLL_DATA) y sin empleado → se ignora

  assert.deepEqual(await fp.ingestCachedFingerprints(DEV), [e.id]);
  assert.equal(await prisma.employee_fingerprint.count({ where: { employee_id: e.id } }), 2);
  assert.equal(await prisma.device_fingerprint_slot.count({ where: { dev_id: DEV, device_user_id: CED } }), 2);
  assert.equal(
    await prisma.employee_device_enrollment.count({ where: { dev_id: DEV, employee_id: e.id, status: "active" } }),
    1,
    "queda vinculado al equipo"
  );
  assert.equal(await prisma.device_fingerprint_slot.count({ where: { dev_id: DEV, device_user_id: "4471" } }), 0);

  // Segunda corrida: ya tienen procedencia → nada nuevo, sin duplicar copias.
  assert.deepEqual(await fp.ingestCachedFingerprints(DEV), []);
  assert.equal(await prisma.employee_fingerprint.count({ where: { employee_id: e.id } }), 2);
});
