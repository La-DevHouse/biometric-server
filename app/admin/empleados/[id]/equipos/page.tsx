import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { applicableDevices } from "@/lib/scope";
import { MAX_FINGERPRINTS, cedulaDigits } from "@/lib/fingerprints";
import { Table, Th, Td, Tr, RowLink } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeTabs } from "@/components/admin/EmployeeTabs";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/**
 * Empleado → Equipos y huellas (docs/11 P1): estado por equipo (los de su
 * alcance ∪ donde está vinculada hoy, docs/10 §6) y sus huellas de referencia.
 */
export default async function EmpleadoEquiposPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const [employee, scopeDevices] = await Promise.all([
    prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        national_id: true,
        enrollments: { where: { status: "active" }, select: { dev_id: true, device_user_id: true } },
        // Orden de captura: las 10 primeras activas son las que se propagan (docs/10 R10).
        fingerprints: {
          where: { status: "active" },
          orderBy: [{ captured_at: "asc" }, { id: "asc" }],
          include: {
            source_device: { select: { dev_id: true, fk_name: true } },
            _count: { select: { slots: true } },
          },
        },
      },
    }),
    applicableDevices(id),
  ]);
  if (!employee) notFound();

  const cedula = cedulaDigits(employee.national_id);
  const inScope = new Set(scopeDevices);
  const linkedBy = new Map(employee.enrollments.map((en) => [en.dev_id, en.device_user_id]));
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
    const status = !inScope.has(d.dev_id)
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
      <EmployeeTabs employeeId={id} active="equipos" />

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">Equipos ({deviceStatus.length})</h3>
        <p className="m-0 text-xs text-text/70">
          Automático: la persona existe en los equipos de las sedes de la empresa de su contrato (y de su grupo si
          comparte empleados), con ID = cédula ({cedula || "—"}). Se actualiza cada 30 min y ante cada cambio.
        </p>
        {deviceStatus.length === 0 ? (
          <EmptyState
            title="Sin equipos"
            description="No tiene un contrato vigente con una empresa que tenga equipos asignados a sus sedes."
          />
        ) : (
          <>
            <div className="hidden md:block">
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
                    <Tr key={d.devId} clickable>
                      <Td>
                        <RowLink href={`/admin/dispositivos/${d.devId}/usuarios`}>{d.name}</RowLink>
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
            </div>
            <MobileList>
              {deviceStatus.map((d) => (
                <MobileRow
                  key={d.devId}
                  href={`/admin/dispositivos/${d.devId}/usuarios`}
                  title={d.name}
                  tags={<Tag variant={d.status.variant}>{d.status.label}</Tag>}
                  fields={[
                    { label: "Empresa · Sede", value: d.place },
                    { label: "Huellas", value: `${d.synced} de ${desired.length}` },
                  ]}
                />
              ))}
            </MobileList>
          </>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
          Huellas ({employee.fingerprints.length})
        </h3>
        <p className="m-0 text-xs text-text/70">
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
                    {i >= MAX_FINGERPRINTS && (
                      <span className="text-accent2"> (no se propaga: pasa de {MAX_FINGERPRINTS})</span>
                    )}
                  </Td>
                  <Td>
                    {fp.source_device ? (
                      <Link href={`/admin/dispositivos/${fp.source_device.dev_id}`} className="text-accent no-underline hover:underline">
                        {fp.source_device.fk_name || fp.source_device.dev_id}
                      </Link>
                    ) : (
                      fp.source_dev_id || "—"
                    )}
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
