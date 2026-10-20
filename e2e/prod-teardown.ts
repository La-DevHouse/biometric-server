// Al terminar una corrida contra producción (prod-colegio.spec.ts): desactiva las
// cuentas de prueba (e2e-…@grupoalco.test) y cierra sus sesiones, para que no quede
// ninguna cuenta usable con una contraseña conocida. No borra nada (la auditoría las
// referencia). Solo toca cuentas con ese dominio de prueba.
import { prisma } from "@/lib/db";

async function main() {
  const users = await prisma.app_user.findMany({
    where: { email: { startsWith: "e2e-", endsWith: "@grupoalco.test" } },
    select: { id: true, email: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.app_session.deleteMany({ where: { app_user_id: { in: ids } } });
  await prisma.app_user.updateMany({ where: { id: { in: ids } }, data: { status: "inactive" } });
  console.log(`[prod-teardown] ${users.length} cuenta(s) de prueba desactivada(s): ${users.map((u) => u.email).join(", ")}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
