"use client";

import { useRouter } from "next/navigation";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";

/** Empresa > Empleados: ir a importar el listado de Galepso (docs/14). */
export function ImportEmployeesButton({ companyId }: { companyId: number }) {
  const router = useRouter();
  return <IconBtn icon={Icon.upload} label="Importar trabajadores desde Galepso" onClick={() => router.push(`/admin/empresas/${companyId}/importar`)} />;
}
