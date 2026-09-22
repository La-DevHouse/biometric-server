import { ReactNode } from "react";
import { initDb, getAsync } from "@/lib/db";
import { requireUser } from "@/lib/auth";
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
  const user = await requireUser();
  await initDb();
  // Badge junto a "Dispositivos" en el menú lateral — se calcula acá (layout,
  // en cada navegación) en vez de en AdminShell porque ese es client
  // component sin acceso directo a la base.
  const deviceCount = await getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM devices`);

  return (
    <AdminShell userName={user.name} userRole={user.role} deviceCount={deviceCount?.n ?? 0}>
      {children}
    </AdminShell>
  );
}
