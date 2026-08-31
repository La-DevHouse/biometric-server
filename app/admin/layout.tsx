import { ReactNode } from "react";
import { initDb } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { listActiveOperations } from "@/lib/operations";
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
  const activeOps = await listActiveOperations();

  return (
    <AdminShell activeOpsCount={activeOps.length} userName={user.name}>
      {children}
    </AdminShell>
  );
}
