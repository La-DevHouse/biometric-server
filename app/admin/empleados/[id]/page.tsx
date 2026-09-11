import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { loadEmploymentLookups, loadDeviceCandidatesForEmployee } from "@/lib/lookups";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeFormDialog, type EmployeeValues } from "@/components/admin/EmployeeFormDialog";
import { EmploymentFormDialog } from "@/components/admin/EmploymentFormDialog";
import { EndEmploymentDialog } from "@/components/admin/EndEmploymentDialog";
import { CaptureFingerprintDialog } from "@/components/admin/CaptureFingerprintDialog";
import { PushFingerprintDialog } from "@/components/admin/PushFingerprintDialog";
import { AddEmployeeToDeviceDialog } from "@/components/admin/AddEmployeeToDeviceDialog";

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

  const [employee, lookups, deviceCandidates] = await Promise.all([
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
        fingerprints: {
          orderBy: [{ finger_index: "asc" }],
          include: { source_device: { select: { dev_id: true, fk_name: true } } },
        },
        _count: { select: { enrollments: true, fingerprints: true } },
      },
    }),
    loadEmploymentLookups(),
    loadDeviceCandidatesForEmployee(id),
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
  const activeEnrollments = employee.enrollments.filter((e) => e.status === "active");

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
        <Field
          label="Huella"
          value={
            employee._count.fingerprints > 0 ? (
              <Tag variant="accent">Sí ({employee._count.fingerprints})</Tag>
            ) : (
              <Tag variant="neutral">No</Tag>
            )
          }
        />
        <Field label="Enrolamientos" value={String(employee._count.enrollments)} />
        <div className="mt-1">
          <EmployeeFormDialog employee={form} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
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
                <Th>Nómina</Th>
                <Th>Período</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {employee.employments.map((em) => (
                <Tr key={em.id}>
                  <Td className="font-medium">{em.company.name}</Td>
                  <Td>{em.site?.name ?? <span className="text-text/60">—</span>}</Td>
                  <Td>{em.employee_group?.name ?? <span className="text-text/60">—</span>}</Td>
                  <Td>
                    {em.position?.name ?? "—"}
                    {em.department?.name && (
                      <span className="text-text/60"> / {em.department.name}</span>
                    )}
                  </Td>
                  <Td className="text-xs">
                    {em.payroll_type ? (
                      em.payroll_type === "quincenal" ? "Quincenal" : "Semanal"
                    ) : (
                      <span className="text-text/60">—</span>
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
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
            Enrolamientos ({activeEnrollments.length} activo{activeEnrollments.length === 1 ? "" : "s"})
          </h3>
          <AddEmployeeToDeviceDialog employeeId={employee.id} candidates={deviceCandidates} />
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
                    <div className="flex items-center gap-2">
                      {en.status === "active" && (
                        <CaptureFingerprintDialog
                          employeeId={employee.id}
                          devId={en.device.dev_id}
                          deviceUserId={en.device_user_id}
                          deviceLabel={en.device.fk_name || en.device.dev_id}
                        />
                      )}
                      <Link
                        href={`/admin/enrolamiento?dev=${en.device.dev_id}`}
                        className="text-xs text-accent no-underline hover:underline"
                      >
                        Gestionar →
                      </Link>
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
            Huellas ({employee.fingerprints.length})
          </h3>
        </div>
        <p className="m-0 mb-2 text-xs text-text/70">
          Copia de referencia de la persona (no la del equipo) — se usa para copiar la huella a otro
          equipo sin tener que volver a enrolarla físicamente ahí.
        </p>
        {employee.fingerprints.length === 0 ? (
          <EmptyState
            title="Sin huellas capturadas"
            description='Capturá una desde un equipo donde la persona ya esté enrolada, arriba en "Enrolamientos".'
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Dedo</Th>
                <Th>Origen</Th>
                <Th>Capturada</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {employee.fingerprints.map((fp) => (
                <Tr key={fp.id}>
                  <Td className="font-mono">{fp.finger_index}</Td>
                  <Td>{fp.source_device?.fk_name || fp.source_dev_id || "—"}</Td>
                  <Td className="text-xs">{fmtDate(fp.captured_at)}</Td>
                  <Td>
                    <PushFingerprintDialog
                      employeeId={employee.id}
                      fingerIndex={fp.finger_index}
                      targets={activeEnrollments
                        .filter((en) => en.device.dev_id !== fp.source_dev_id)
                        .map((en) => ({
                          devId: en.device.dev_id,
                          label: `${en.device.fk_name || en.device.dev_id} (usuario ${en.device_user_id})`,
                        }))}
                    />
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
      <span className="w-48 flex-none text-text/70">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
