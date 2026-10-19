import { ReactNode } from "react";
import { initDb, getAsync } from "@/lib/db";
import { requireAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata = {
  title: "Marcaje — Panel de administración",
  description: "Panel de administración del servidor biométrico",
};

// force-dynamic: la página pega a Postgres en un Server Component; con `revalidate`
// Next intenta prerenderizarla en `next build`, lo que exige la BD accesible en
// build time (falla en Coolify: el hostname interno no resuelve en el builder).
export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const access = await requireAccess();
  const user = access.user;
  await initDb();
  // Badge junto a "Equipos" en el menú lateral — se calcula acá (layout,
  // en cada navegación) en vez de en AdminShell porque ese es client
  // component sin acceso directo a la base.
  // Cuenta limitada (docs/18): solo los equipos de sus empresas.
  const deviceCount =
    access.companyIds === null
      ? await getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM devices`)
      : { n: await prisma.devices.count({ where: { site: { company_id: { in: access.companyIds } } } }) };

  return (
    <AdminShell userName={user.name} userRole={user.role} deviceCount={deviceCount?.n ?? 0}>
      {children}
    </AdminShell>
  );
}
