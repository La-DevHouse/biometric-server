import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { ResyncEnrollmentsButton } from "@/components/admin/ResyncEnrollmentsButton";
import { activeEmploymentWhere, devicesInCompanyScope } from "@/lib/scope";
import { cedulaDigits, MAX_FINGERPRINTS } from "@/lib/fingerprints";

export const dynamic = "force-dynamic";

interface Row {
  employeeId: number;
  name: string;
  nationalId: string;
  position: string | null;
  schedule: string | null;
  fingerprints: number; // copias canónicas activas
  onDevices: number; // equipos del alcance donde está vinculada
  complete: number; // de esos, donde tiene todas sus huellas (hasta 10)
}

/**
 * Empresa > Empleados (docs/10 §6): quién tiene contrato vigente con esta empresa
 * y cómo está en los equipos de su alcance (los de sus sedes, y los de su grupo si
 * comparte empleados). El estado de cada equipo lo mantiene el reconciliador.
 */
export default async function EmpresaEmpleadosPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const company = await prisma.client_company.findUnique({ where: { id }, select: { id: true, name: true, status: true } });
  if (!company) notFound();

  const [contracts, scopeDevices] = await Promise.all([
    prisma.employment.findMany({
      where: { company_id: id, ...activeEmploymentWhere() },
      include: {
        employee: { select: { id: true, first_name: true, last_name: true, national_id: true } },
        position: { select: { name: true } },
        schedule_group: { select: { name: true } },
      },
      orderBy: [{ employee: { last_name: "asc" } }, { employee: { first_name: "asc" } }],
    }),
    devicesInCompanyScope(id),
  ]);

  const employeeIds = [...new Set(contracts.map((c) => c.employee_id))];
  const [fps, links, slots] = await Promise.all([
    prisma.employee_fingerprint.findMany({
      where: { employee_id: { in: employeeIds }, status: "active" },
      orderBy: [{ captured_at: "asc" }, { id: "asc" }],
      select: { id: true, employee_id: true },
    }),
    prisma.employee_device_enrollment.findMany({
      where: { employee_id: { in: employeeIds }, status: "active", dev_id: { in: scopeDevices } },
      select: { employee_id: true, dev_id: true, device_user_id: true },
    }),
    prisma.device_fingerprint_slot.findMany({
      where: { dev_id: { in: scopeDevices }, fingerprint_id: { not: null } },
      select: { dev_id: true, device_user_id: true, fingerprint_id: true },
    }),
  ]);

  const desiredByEmployee = new Map<number, number[]>();
  for (const f of fps) {
    const list = desiredByEmployee.get(f.employee_id) ?? [];
    if (list.length < MAX_FINGERPRINTS) list.push(f.id);
    desiredByEmployee.set(f.employee_id, list);
  }
  const slotSet = new Set(slots.map((s) => `${s.dev_id}|${s.device_user_id}|${s.fingerprint_id}`));

  const seen = new Set<number>();
  const rows: Row[] = [];
  for (const c of contracts) {
    if (seen.has(c.employee_id)) continue;
    seen.add(c.employee_id);
    const desired = desiredByEmployee.get(c.employee_id) ?? [];
    const myLinks = links.filter((l) => l.employee_id === c.employee_id);
    const complete = myLinks.filter((l) => desired.every((f) => slotSet.has(`${l.dev_id}|${l.device_user_id}|${f}`))).length;
    rows.push({
      employeeId: c.employee_id,
      name: `${c.employee.last_name}, ${c.employee.first_name}`,
      nationalId: c.employee.national_id,
      position: c.position?.name ?? null,
      schedule: c.schedule_group?.name ?? null,
      fingerprints: fps.filter((f) => f.employee_id === c.employee_id).length,
      onDevices: myLinks.length,
      complete: desired.length === 0 ? 0 : complete,
    });
  }

  const total = scopeDevices.length;
  const status = (r: Row) =>
    r.fingerprints === 0
      ? { label: "Sin huella", variant: "neutral" as const }
      : r.onDevices < total
        ? { label: `Falta en ${total - r.onDevices} equipo(s)`, variant: "neutral" as const }
        : r.complete < total
          ? { label: "Huellas incompletas", variant: "neutral" as const }
          : { label: "Al día", variant: "accent" as const };

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <CompanyTabs
        companyId={company.id}
        companyName={company.name}
        active="empleados"
        actions={<ResyncEnrollmentsButton companyId={company.id} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-text/75">
          {rows.length} {rows.length === 1 ? "persona" : "personas"} con contrato vigente · {total} equipo(s) en su
          alcance{" "}
          <span className="text-text/60">(sedes de la empresa, y de su grupo si comparte empleados)</span>
        </p>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Sin contratos vigentes"
          description="Cuando alguien tenga un contrato con esta empresa, va a aparecer acá y se enrola solo en los equipos de su alcance."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Persona</Th>
                  <Th>Cédula</Th>
                  <Th>Cargo / Horario</Th>
                  <Th>Huellas</Th>
                  <Th>Equipos</Th>
                  <Th>Estado</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const st = status(r);
                  return (
                    <Tr key={r.employeeId}>
                      <Td>
                        <Link href={`/admin/empleados/${r.employeeId}`} className="text-accent no-underline hover:underline">
                          {r.name}
                        </Link>
                      </Td>
                      <Td className="font-mono text-xs">{r.nationalId}</Td>
                      <Td className="text-xs">
                        {r.position ?? "—"}
                        {r.schedule && <span className="text-text/60"> · {r.schedule}</span>}
                      </Td>
                      <Td>{r.fingerprints}</Td>
                      <Td className="text-xs">
                        en {r.onDevices} de {total}
                        {r.fingerprints > 0 && <span className="text-text/60"> · completas en {r.complete}</span>}
                      </Td>
                      <Td>
                        <Tag variant={st.variant}>{st.label}</Tag>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {rows.map((r) => {
              const st = status(r);
              return (
                <MobileRow
                  key={r.employeeId}
                  href={`/admin/empleados/${r.employeeId}`}
                  title={r.name}
                  tags={<Tag variant={st.variant}>{st.label}</Tag>}
                  fields={[
                    { label: "Cédula", value: r.nationalId },
                    { label: "Huellas", value: r.fingerprints },
                    { label: "Equipos", value: `en ${r.onDevices} de ${total}` },
                  ]}
                />
              );
            })}
          </MobileList>
        </>
      )}
      <p className="m-0 text-xs text-text/60">
        El ID de cada persona en los equipos es su cédula sin prefijo (
        {rows[0] ? cedulaDigits(rows[0].nationalId) : "ej. 12345678"}). Los equipos se actualizan solos cada 30 min y ante
        cada cambio de contrato.
      </p>
    </div>
  );
}
