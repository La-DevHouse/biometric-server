// Crea (o resetea) un usuario interno de la plataforma.
//
//   tsx scripts/create-user.ts <email> "<nombre>" <password>
//
// Idempotente: si el email ya existe, actualiza nombre + contraseña y lo
// reactiva. En Fase 1 todos son 'admin' (sin matriz de permisos).

import { prisma, closeDb } from "@/lib/db";
import { hashPassword } from "@/lib/password";

async function main() {
  const [emailRaw, name, password] = process.argv.slice(2);
  if (!emailRaw || !name || !password) {
    console.error('Uso: tsx scripts/create-user.ts <email> "<nombre>" <password>');
    process.exit(1);
  }
  const email = emailRaw.trim().toLowerCase();
  const password_hash = await hashPassword(password);

  const user = await prisma.app_user.upsert({
    where: { email },
    update: { name, password_hash, status: "active" },
    create: { email, name, password_hash },
  });

  console.log(`✓ usuario ${user.email} (id ${user.id}) listo — rol ${user.role}`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => {});
  process.exit(1);
});
