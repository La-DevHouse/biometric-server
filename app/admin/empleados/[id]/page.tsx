import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { loadEmploymentLookups } from "@/lib/lookups";
import { applicableDevices } from "@/lib/scope";
import { MAX_FINGERPRINTS, cedulaDigits } from "@/lib/fingerprints";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeFormDialog, type EmployeeValues } from "@/components/admin/EmployeeFormDialog";
import { EmploymentFormDialog } from "@/components/admin/EmploymentFormDialog";
import { EndEmploymentDialog } from "@/components/admin/EndEmploymentDialog";
import { MultiOpButton } from "@/components/admin/MultiOpButton";
import { syncEmployeeNowAction } from "@/app/admin/actions";

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

  const [employee, lookups, scopeDevices] = await Promise.all([
    prisma.employee.findUnique({
      where: { id },
      include: {
        employments: {
          orderBy: [{ start_date: "desc" }],
          include: {
            company: { select: { name: true } },
            schedule_group: { select: { name: true } },
            position: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        enrollments: {
          orderBy: [{ status: "asc" }, { enrolled_at: "desc" }],
          include: { device: { select: { dev_id: true, fk_name: true } } },
        },
        // Orden de captura: las 10 primeras activas son las que se propagan (docs/10 R10).
        fingerprints: {
          where: { status: "active" },
          orderBy: [{ captured_at: "asc" }, { id: "asc" }],
          include: {
            source_device: { select: { dev_id: true, fk_name: true } },
            _count: { select: { slots: true } },
          },
        },
        _count: { select: { enrollments: true, fingerprints: true } },
      },
    }),
    loadEmploymentLookups(),
    applicableDevices(id),
  ]);
  if (!employee) notFound();

  const form: EmployeeValues = {
    id: employee.id,
    national_id: employee.national_id,
    tax_id: employee.tax_id,
    first_name: employee.first_name,
    last_name: employee.last_name,
    birth_date: employee.birth_date ? fmtDate(employee.birth_date) : null,
    has_cedula_photo: employee.cedula_photo != null,
  };
  const activeEmployment = employee.employments.find((e) => e.status === "active");
  const activeEnrollments = employee.enrollments.filter((e) => e.status === "active");

  // Estado por equipo (docs/10 §6): los de su alcance ∪ donde está vinculada hoy.
  const cedula = cedulaDigits(employee.national_id);
  const inScope = new Set(scopeDevices);
  const linkedBy = new Map(activeEnrollments.map((en) => [en.dev_id, en.device_user_id]));
  const deviceIds = [...new Set([...scopeDevices, ...linkedBy.keys()])];
  const desired = employee.fingerprints.slice(0, MAX_FINGERPRINTS).map((f) => f.id);
  const [deviceRows, mySlots] = await Promise.all([
    prisma.devices.findMany({
      where: { dev_id: { in: deviceIds } },
      select: { dev_id: true, fk_name: true, site: { select: { name: true, company: { select: { name: true } } } } },
      orderBy: { dev_id: "asc" },
    }),
    prisma.device_fingerprint_slot.findMany({
      where: { dev_id: { in: deviceIds }, device_user_id: cedula },
      select: { dev_id: true, fingerprint_id: true },
    }),
  ]);
  const deviceStatus = deviceRows.map((d) => {
    const linked = linkedBy.get(d.dev_id) ?? null;
    const have = new Set(mySlots.filter((x) => x.dev_id === d.dev_id).map((x) => x.fingerprint_id));
    const synced = desired.filter((f) => have.has(f)).length;
    const scoped = inScope.has(d.dev_id);
    const status = !scoped
      ? { label: "Se quita (fuera del alcance)", variant: "neutral" as const }
      : !linked
        ? { label: "Pendiente de crear", variant: "neutral" as const }
        : synced < desired.length
          ? { label: "Faltan huellas", variant: "neutral" as const }
          : { label: "Al día", variant: "accent" as const };
    return {
      devId: d.dev_id,
      name: d.fk_name || d.dev_id,
      place: d.site ? `${d.site.company.name} · ${d.site.name}` : "sin sede",
      linked,
      synced,
      status,
    };
  });

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/admin/empleados" className="text-xs text-accent no-underline hover:underline">
          ← Empleados
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h2 className="font-heading text-2xl font-semibold tracking-tight m-0">
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
          label="Cédula (foto)"
          value={
            employee.cedula_photo != null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/admin/empleados/${employee.id}/cedula`}
                alt="cédula escaneada"
                className="h-10 w-auto border border-divider bg-surface object-contain p-0.5"
              />
            ) : (
              "—"
            )
          }
        />
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
            description="Esta persona está en el pool de reclutamiento. Registrale un contrato para vincularla a una empresa."
          />
        ) : (
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
              {employee.employments.map((em) => (
                <Tr key={em.id}>
                  <Td className="font-medium">{em.company.name}</Td>
                  <Td>{em.schedule_group?.name ?? <span className="text-text/60">—</span>}</Td>
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
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
            Equipos ({deviceStatus.length})
          </h3>
          <MultiOpButton
            action={syncEmployeeNowAction}
            hidden={{ employee_id: String(employee.id) }}
            title="Sincronizar ahora"
            description="Corre la sincronización en los equipos de su alcance y donde está hoy: la crea donde falte, le copia las huellas que falten y la quita de donde ya no corresponda."
          >
            Sincronizar ahora
          </MultiOpButton>
        </div>
        <p className="m-0 mb-2 text-xs text-text/70">
          Automático: la persona existe en los equipos de las sedes de la empresa de su contrato (y de su grupo si
          comparte empleados), con ID = cédula ({cedula || "—"}). Se actualiza cada 30 min y ante cada cambio.
        </p>
        {deviceStatus.length === 0 ? (
          <EmptyState
            title="Sin equipos"
            description="No tiene un contrato vigente con una empresa que tenga equipos asignados a sus sedes."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Equipo</Th>
                <Th>Empresa · Sede</Th>
                <Th>ID en equipo</Th>
                <Th>Huellas</Th>
                <Th>Estado</Th>
              </tr>
            </thead>
            <tbody>
              {deviceStatus.map((d) => (
                <Tr key={d.devId}>
                  <Td>
                    <Link href={`/admin/enrolamiento?dev=${d.devId}`} className="text-accent no-underline hover:underline">
                      {d.name}
                    </Link>
                  </Td>
                  <Td className="text-xs">{d.place}</Td>
                  <Td className="font-mono">{d.linked ?? <span className="text-text/60">—</span>}</Td>
                  <Td>
                    {d.synced} de {desired.length}
                  </Td>
                  <Td>
                    <Tag variant={d.status.variant}>{d.status.label}</Tag>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/75">
          Huellas ({employee.fingerprints.length})
        </h3>
        <p className="m-0 mb-2 text-xs text-text/70">
          Copias de referencia de la persona. Se registran solas cuando enrola un dedo en el teclado de cualquier equipo
          de su alcance, y se copian a los demás. Se propagan las {MAX_FINGERPRINTS} primeras (límite del equipo).
        </p>
        {employee.fingerprints.length === 0 ? (
          <EmptyState
            title="Sin huellas"
            description="Registrale un dedo físicamente en cualquier equipo de su alcance: se detecta solo y se copia a los demás."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Origen</Th>
                <Th>En equipos</Th>
                <Th>Capturada</Th>
              </tr>
            </thead>
            <tbody>
              {employee.fingerprints.map((fp, i) => (
                <Tr key={fp.id}>
                  <Td className="font-mono">
                    {i + 1}
                    {i >= MAX_FINGERPRINTS && <span className="text-accent2"> (no se propaga: pasa de {MAX_FINGERPRINTS})</span>}
                  </Td>
                  <Td>
                    {fp.source_device?.fk_name || fp.source_dev_id || "—"}
                    {fp.source_backup_number != null && <span className="text-text/60"> · slot {fp.source_backup_number}</span>}
                  </Td>
                  <Td>{fp._count.slots}</Td>
                  <Td className="text-xs">{fmtDate(fp.captured_at)}</Td>
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
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="sm:w-48 sm:flex-none text-text/70">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
