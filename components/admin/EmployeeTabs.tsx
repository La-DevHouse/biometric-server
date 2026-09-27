import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { activeEmploymentWhere } from "@/lib/scope";
import { Tabs, DetailHeader } from "@/components/ui/Tabs";
import { Tag } from "@/components/ui/Tag";
import { Icon } from "@/components/ui/icons";
import { EmployeeFormDialog, type EmployeeValues } from "./EmployeeFormDialog";
import { MultiOpButton } from "./MultiOpButton";
import { syncEmployeeNowAction } from "@/app/admin/actions";

export type EmployeeTab = "info" | "contratos" | "equipos";

function fmtDate(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * Encabezado + pestañas de un empleado (docs/11 P1): Información / Contratos de
 * trabajo / Equipos y huellas. Acciones: editar datos y sincronizar ahora.
 * Carga lo suyo (sin traer el binario de la foto de cédula); 404 si no existe.
 */
export async function EmployeeTabs({ employeeId, active }: { employeeId: number; active: EmployeeTab }) {
  const [employee, withPhoto, vigentes] = await Promise.all([
    prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, national_id: true, tax_id: true, first_name: true, last_name: true, birth_date: true },
    }),
    prisma.$queryRaw<{ id: number }[]>`SELECT id FROM employee WHERE id = ${employeeId} AND cedula_photo IS NOT NULL`,
    prisma.employment.count({ where: { employee_id: employeeId, ...activeEmploymentWhere() } }),
  ]);
  if (!employee) notFound();

  const form: EmployeeValues = {
    id: employee.id,
    national_id: employee.national_id,
    tax_id: employee.tax_id,
    first_name: employee.first_name,
    last_name: employee.last_name,
    birth_date: fmtDate(employee.birth_date),
    has_cedula_photo: withPhoto.length > 0,
  };
  const base = `/admin/empleados/${employee.id}`;

  return (
    <div className="flex flex-col gap-3">
      <DetailHeader
        backHref="/admin/empleados"
        backLabel="Empleados"
        title={`${employee.first_name} ${employee.last_name}`}
        badges={vigentes > 0 ? <Tag variant="accent">Activo</Tag> : <Tag variant="neutral">Pool</Tag>}
        subtitle={<span className="font-mono">{employee.national_id}</span>}
        actions={
          <>
            <EmployeeFormDialog employee={form} />
            <MultiOpButton
              action={syncEmployeeNowAction}
              hidden={{ employee_id: String(employee.id) }}
              title="Sincronizar ahora"
              variant="icon"
              description="Corre la sincronización en los equipos de su alcance y donde está hoy: la crea donde falte, le copia las huellas que falten y la quita de donde ya no corresponda."
            >
              {Icon.sync}
            </MultiOpButton>
          </>
        }
      />
      <Tabs
        label="Secciones del empleado"
        active={active}
        items={[
          { key: "info", label: "Información", href: base },
          { key: "contratos", label: "Contratos de trabajo", href: `${base}/contratos` },
          { key: "equipos", label: "Equipos y huellas", href: `${base}/equipos` },
        ]}
      />
    </div>
  );
}
