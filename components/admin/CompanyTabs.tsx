import { Tabs, DetailHeader } from "@/components/ui/Tabs";

/**
 * Encabezado + pestañas de una empresa (docs/11 C3). Usa el patrón estándar
 * de detalle (components/ui/Tabs): Información / Sedes / Empleados / Asistencia.
 */
export function CompanyTabs({
  companyId,
  companyName,
  active,
  badges,
  actions,
}: {
  companyId: number;
  companyName: string;
  active: "datos" | "sedes" | "empleados" | "asistencia";
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const base = `/admin/empresas/${companyId}`;
  return (
    <div className="flex flex-col gap-3">
      <DetailHeader backHref="/admin/empresas" backLabel="Empresas" title={companyName} badges={badges} actions={actions} />
      <Tabs
        label="Secciones de la empresa"
        active={active}
        items={[
          { key: "datos", label: "Información", href: base },
          { key: "sedes", label: "Sedes", href: `${base}/sedes` },
          { key: "empleados", label: "Empleados", href: `${base}/empleados` },
          { key: "asistencia", label: "Asistencia", href: `${base}/asistencia` },
        ]}
      />
    </div>
  );
}
