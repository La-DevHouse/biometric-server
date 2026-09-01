import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { loadEmploymentLookups } from "@/lib/lookups";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeFormDialog, type EmployeeValues } from "@/components/admin/EmployeeFormDialog";
import { EmploymentFormDialog } from "@/components/admin/EmploymentFormDialog";
import { EndEmploymentDialog } from "@/components/admin/EndEmploymentDialog";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

export default async function EmpleadoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const [employee, lookups] = await Promise.all([
    prisma.employee.findUnique({
      where: { id },
      include: {
        employments: {
          orderBy: [{ start_date: "desc" }],
          include: {
            company: { select: { name: true } },
            site: { select: { name: true } },
            employee_group: { select: { name: true } },
            position: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        enrollments: {
          orderBy: [{ status: "asc" }, { enrolled_at: "desc" }],
          include: { device: { select: { dev_id: true, fk_name: true } } },
        },
        _count: { select: { enrollments: true, fingerprints: true } },
      },
    }),
    loadEmploymentLookups(),
  ]);
  if (!employee) notFound();

  const form: EmployeeValues = {
    id: employee.id,
    national_id: employee.national_id,
    tax_id: employee.tax_id,
    first_name: employee.first_name,
    last_name: employee.last_name,
    birth_date: employee.birth_date ? fmtDate(employee.birth_date) : null,
  };
  const activeEmployment = employee.employments.find((e) => e.status === "active");

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/admin/empleados" className="text-xs text-accent no-underline hover:underline">
          ← Empleados
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h2 className="m-0 text-2xl">
            {employee.first_name} {employee.last_name}
          </h2>
          {activeEmployment ? <Tag variant="accent">Activo</Tag> : <Tag variant="neutral">Pool</Tag>}
        </div>
      </div>

      <section className="flex flex-col gap-2 border border-divider p-4 text-sm">
        <Field label="Documento" value={employee.national_id} mono />
        <Field label="RIF" value={employee.tax_id ?? "—"} mono />
        <Field label="Fecha de nacimiento" value={fmtDate(employee.birth_date)} />
        <Field label="Huellas / enrolamientos" value={`${employee._count.fingerprints} · ${employee._count.enrollments}`} />
        <div className="mt-1">
          <EmployeeFormDialog employee={form} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">
            Empleos ({employee.employments.length})
          </h3>
          <EmploymentFormDialog employeeId={employee.id} lookups={lookups} mode="create" />
        </div>

        {employee.employments.length === 0 ? (
          <EmptyState
            title="Sin empleos"
            description="Esta persona está en el pool de reclutamiento. Registrale un empleo para vincularla a una empresa."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Empresa</Th>
                <Th>Sede</Th>
                <Th>Grupo</Th>
                <Th>Puesto / Depto</Th>
                <Th>Período</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {employee.employments.map((em) => (
                <Tr key={em.id}>
                  <Td className="font-medium">{em.company.name}</Td>
                  <Td>{em.site?.name ?? <span className="text-text/40">—</span>}</Td>
                  <Td>{em.employee_group?.name ?? <span className="text-text/40">—</span>}</Td>
                  <Td>
                    {em.position?.name ?? "—"}
                    {em.department?.name && (
                      <span className="text-text/40"> / {em.department.name}</span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {fmtDate(em.start_date)} → {em.end_date ? fmtDate(em.end_date) : "∞"}
                  </Td>
                  <Td>
                    <Tag variant={em.status === "active" ? "accent" : "neutral"}>
                      {em.status === "active" ? "Activo" : "Cerrado"}
                    </Tag>
                  </Td>
                  <Td>
                    {em.status === "active" && (
                      <span className="inline-flex items-center gap-1">
                        <EmploymentFormDialog
                          employeeId={employee.id}
                          lookups={lookups}
                          mode="transfer"
                          fromEmploymentId={em.id}
                        />
                        <EndEmploymentDialog employmentId={em.id} companyName={em.company.name} />
                      </span>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">
            Enrolamientos ({employee.enrollments.filter((e) => e.status === "active").length} activo
            {employee.enrollments.filter((e) => e.status === "active").length === 1 ? "" : "s"})
          </h3>
        </div>
        {employee.enrollments.length === 0 ? (
          <EmptyState
            title="Sin enrolamientos"
            description="Vinculá a la persona con un slot de equipo desde Administración → Enrolamiento."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Equipo</Th>
                <Th>Slot</Th>
                <Th>Estado</Th>
                <Th>Desde</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {employee.enrollments.map((en) => (
                <Tr key={en.id}>
                  <Td>{en.device.fk_name || en.device.dev_id}</Td>
                  <Td className="font-mono">{en.device_user_id}</Td>
                  <Td>
                    <Tag variant={en.status === "active" ? "accent" : "neutral"}>
                      {en.status === "active" ? "Activo" : "Cerrado"}
                    </Tag>
                  </Td>
                  <Td className="text-xs">{fmtDate(en.enrolled_at)}</Td>
                  <Td>
                    <Link
                      href={`/admin/enrolamiento?dev=${en.device.dev_id}`}
                      className="text-xs text-accent no-underline hover:underline"
                    >
                      Gestionar →
                    </Link>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-48 flex-none text-text/50">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
