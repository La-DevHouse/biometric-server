import { ReactNode } from "react";
import { initDb } from "@/lib/db";
import { listActiveOperations } from "@/lib/operations";
import { AdminShell } from "@/components/admin/AdminShell";

export const metadata = {
  title: "Marcaje — Panel de administración",
  description: "Panel de administración del servidor biométrico",
};

export const revalidate = 3;

export default async function AdminLayout({ children }: { children: ReactNode }) {
  await initDb();
  const activeOps = await listActiveOperations();

  return <AdminShell activeOpsCount={activeOps.length}>{children}</AdminShell>;
}
