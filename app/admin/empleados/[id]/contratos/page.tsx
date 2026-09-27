import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { loadEmploymentLookups } from "@/lib/lookups";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeTabs } from "@/components/admin/EmployeeTabs";
import { EmploymentFormDialog, type EditableEmployment } from "@/components/admin/EmploymentFormDialog";
import { EndEmploymentDialog } from "@/components/admin/EndEmploymentDialog";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/**
 * Empleado → Contratos de trabajo (docs/11 P1/P2): alta, edición (misma fila,
 * sin cambiar la empresa) y baja. No hay "Trasladar": otra empresa = baja +
 * contrato nuevo, cada paso con su aviso de impacto.
 */
export default async function EmpleadoContratosPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const [employments, lookups] = await Promise.all([
    prisma.employment.findMany({
      where: { employee_id: id },
      orderBy: [{ start_date: "desc" }],
      include: {
        company: { select: { name: true } },
        schedule_group: { select: { name: true } },
        position: { select: { name: true } },
        department: { select: { name: true } },
      },
    }),
    loadEmploymentLookups(),
  ]);

  type Em = (typeof employments)[number];
  const editable = (em: Em): EditableEmployment => ({
    id: em.id,
    company_id: em.company_id,
    company_name: em.company.name,
    schedule_group_id: em.schedule_group_id,
    position_id: em.position_id,
    department_id: em.department_id,
    payroll_ref: em.payroll_ref,
    payroll_type: em.payroll_type,
    start_date: fmtDate(em.start_date),
  });
  const actions = (em: Em) =>
    em.status === "active" ? (
      <span className="inline-flex items-center gap-1">
        <EmploymentFormDialog employeeId={id} lookups={lookups} mode="edit" employment={editable(em)} />
        <EndEmploymentDialog employmentId={em.id} companyName={em.company.name} />
      </span>
    ) : null;
  const payroll = (em: Em) =>
    em.payroll_type ? (em.payroll_type === "quincenal" ? "Quincenal" : "Semanal") : "—";
  const period = (em: Em) => `${fmtDate(em.start_date)} → ${em.end_date ? fmtDate(em.end_date) : "∞"}`;
  const statusTag = (em: Em) => (
    <Tag variant={em.status === "active" ? "accent" : "neutral"}>{em.status === "active" ? "Vigente" : "Cerrado"}</Tag>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <EmployeeTabs employeeId={id} active="contratos" />

      {employments.length === 0 ? (
        <EmptyState
          title="Sin contratos de trabajo"
          description="Esta persona está en el pool de reclutamiento. Registrale un contrato para vincularla a una empresa."
          action={<EmploymentFormDialog employeeId={id} lookups={lookups} mode="create" variant="button" />}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-sm text-text/75">{employments.length} contrato(s)</p>
            <EmploymentFormDialog employeeId={id} lookups={lookups} mode="create" />
          </div>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Empresa</Th>
                  <Th>Horario</Th>
                  <Th>Puesto / Depto</Th>
                  <Th>Nómina</Th>
                  <Th>Período</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {employments.map((em) => (
                  <Tr key={em.id}>
                    <Td className="font-medium">{em.company.name}</Td>
                    <Td>{em.schedule_group?.name ?? <span className="text-text/60">—</span>}</Td>
                    <Td>
                      {em.position?.name ?? "—"}
                      {em.department?.name && <span className="text-text/60"> / {em.department.name}</span>}
                    </Td>
                    <Td className="text-xs">
                      {payroll(em)}
                      {em.payroll_ref && <span className="text-text/60"> · {em.payroll_ref}</span>}
                    </Td>
                    <Td className="text-xs">{period(em)}</Td>
                    <Td>{statusTag(em)}</Td>
                    <Td actions>{actions(em)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {employments.map((em) => (
              <MobileRow
                key={em.id}
                title={em.company.name}
                tags={statusTag(em)}
                accent={em.status === "active" ? "accent" : "neutral"}
                fields={[
                  { label: "Período", value: period(em) },
                  { label: "Horario", value: em.schedule_group?.name ?? "—" },
                  { label: "Puesto", value: em.position?.name ?? "—" },
                  { label: "Nómina", value: payroll(em) },
                ]}
                actions={actions(em)}
              />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}
