import Link from "next/link";
import { Suspense } from "react";
import { allAsync, initDb, prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { DeviceSelect } from "@/components/ui/DeviceSelect";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/EmptyState";
import { AssignEnrollmentDialog } from "@/components/admin/AssignEnrollmentDialog";
import { UnlinkEnrollmentButton } from "@/components/admin/UnlinkEnrollmentButton";

// force-dynamic: pega a Postgres en un Server Component; con `revalidate` Next
// intenta prerenderizar en build y la BD no resuelve en el builder de Coolify.
export const dynamic = "force-dynamic";

interface SlotRow {
  user_id: string;
  user_name: string | null;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

async function loadCandidates(companyIds: number[] | null) {
  const emps = await prisma.employee.findMany({
    where: {
      employments: {
        some: companyIds ? { status: "active", company_id: { in: companyIds } } : { status: "active" },
      },
    },
    select: { id: true, first_name: true, last_name: true, national_id: true },
    orderBy: [{ last_name: "asc" }, { first_name: "asc" }],
    take: 500,
  });
  return emps.map((e) => ({ id: e.id, label: `${e.last_name}, ${e.first_name} — ${e.national_id}` }));
}

export default async function EnrolamientoPage({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string }>;
}) {
  await requireUser();
  await initDb();
  const { dev } = await searchParams;

  const devices = await allAsync<{ dev_id: string; fk_name: string | null; company_id: number | null }>(
    `SELECT dev_id, fk_name, company_id FROM devices ORDER BY dev_id`
  );
  const effectiveDevId = dev || devices[0]?.dev_id;

  if (!effectiveDevId) {
    return (
      <EmptyState
        title="Todavía no hay dispositivos"
        description="Conectá un equipo para poder enrolar empleados."
      />
    );
  }

  const device = devices.find((d) => d.dev_id === effectiveDevId);

  const [slots, enrollments] = await Promise.all([
    allAsync<SlotRow>(
      `SELECT user_id, user_name FROM users WHERE dev_id = ?
        ORDER BY NULLIF(regexp_replace(user_id, '\\D', '', 'g'), '')::bigint NULLS LAST, user_id`,
      [effectiveDevId]
    ),
    prisma.employee_device_enrollment.findMany({
      where: { dev_id: effectiveDevId },
      include: {
        employee: { select: { id: true, first_name: true, last_name: true, national_id: true } },
      },
      orderBy: [{ status: "asc" }, { enrolled_at: "desc" }],
    }),
  ]);

  const activeBySlot = new Map<string, (typeof enrollments)[number]>();
  for (const e of enrollments) if (e.status === "active") activeBySlot.set(e.device_user_id, e);

  // Candidatos: empleados con empleo activo en la empresa del equipo (+ padre e hijas).
  let companyScopeNote: string | null = null;
  let candidates: { id: number; label: string }[];
  if (device?.company_id) {
    const company = await prisma.client_company.findUnique({
      where: { id: device.company_id },
      include: { parent: { select: { id: true } }, children: { select: { id: true } } },
    });
    const companyIds = company
      ? [company.id, ...(company.parent ? [company.parent.id] : []), ...company.children.map((c) => c.id)]
      : [device.company_id];
    candidates = await loadCandidates(companyIds);
  } else {
    companyScopeNote =
      "Este equipo no está asignado a ninguna empresa. Asignalo en su ficha para acotar la lista de empleados.";
    candidates = await loadCandidates(null);
  }

  const orphanEnrollments = enrollments.filter(
    (e) => e.status === "active" && !slots.some((s) => s.user_id === e.device_user_id)
  );

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Suspense fallback={<div className="min-h-9 w-40 border border-divider bg-surface" />}>
          <DeviceSelect
            devices={devices.map((d) => ({ dev_id: d.dev_id, label: d.fk_name || d.dev_id }))}
            allowAll={false}
          />
        </Suspense>
        <span className="text-xs text-text/50">
          {slots.length} slot{slots.length === 1 ? "" : "s"} en el equipo · {activeBySlot.size}{" "}
          vinculado{activeBySlot.size === 1 ? "" : "s"}
        </span>
      </div>

      {companyScopeNote && (
        <p className="m-0 border border-divider bg-surface p-2.5 text-xs text-text/70">
          {companyScopeNote}
        </p>
      )}

      {slots.length === 0 ? (
        <EmptyState
          title="El equipo no reporta usuarios"
          description="Sincronizá la lista de usuarios del equipo (pantalla Usuarios) para ver los slots a enrolar."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Slot</Th>
              <Th>Nombre en el equipo</Th>
              <Th>Empleado vinculado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {slots.map((s) => {
              const en = activeBySlot.get(s.user_id);
              return (
                <Tr key={s.user_id}>
                  <Td className="font-mono">{s.user_id}</Td>
                  <Td>{s.user_name || <span className="text-text/40">—</span>}</Td>
                  <Td>
                    {en ? (
                      <Link
                        href={`/admin/empleados/${en.employee.id}`}
                        className="text-accent no-underline hover:underline"
                      >
                        {en.employee.last_name}, {en.employee.first_name}
                        <span className="text-text/40"> · {en.employee.national_id}</span>
                      </Link>
                    ) : (
                      <span className="text-text/40">Sin vincular</span>
                    )}
                  </Td>
                  <Td>
                    {en ? (
                      <UnlinkEnrollmentButton id={en.id} />
                    ) : (
                      <AssignEnrollmentDialog
                        devId={effectiveDevId}
                        deviceUserId={s.user_id}
                        deviceUserName={s.user_name}
                        candidates={candidates}
                      />
                    )}
                  </Td>
                </Tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {orphanEnrollments.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">
            Vínculos sin slot en el equipo ({orphanEnrollments.length})
          </h3>
          <p className="m-0 text-xs text-text/50">
            La persona sigue vinculada a un ID que el equipo ya no reporta (se borró del equipo o aún
            no se sincronizó). Revisá y desvinculá si corresponde.
          </p>
          <Table>
            <thead>
              <tr>
                <Th>Slot</Th>
                <Th>Empleado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {orphanEnrollments.map((e) => (
                <Tr key={e.id}>
                  <Td className="font-mono">{e.device_user_id}</Td>
                  <Td>
                    <Link
                      href={`/admin/empleados/${e.employee.id}`}
                      className="text-accent no-underline hover:underline"
                    >
                      {e.employee.last_name}, {e.employee.first_name}
                    </Link>
                  </Td>
                  <Td>
                    <UnlinkEnrollmentButton id={e.id} />
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </section>
      )}

      {enrollments.some((e) => e.status === "inactive") && (
        <details className="text-xs text-text/50">
          <summary className="cursor-pointer">Histórico de vínculos cerrados</summary>
          <Table>
            <thead>
              <tr>
                <Th>Slot</Th>
                <Th>Empleado</Th>
                <Th>Desde</Th>
                <Th>Hasta</Th>
              </tr>
            </thead>
            <tbody>
              {enrollments
                .filter((e) => e.status === "inactive")
                .map((e) => (
                  <Tr key={e.id}>
                    <Td className="font-mono">{e.device_user_id}</Td>
                    <Td>
                      {e.employee.last_name}, {e.employee.first_name}
                    </Td>
                    <Td>{fmtDate(e.enrolled_at)}</Td>
                    <Td>{fmtDate(e.ended_at)}</Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
        </details>
      )}
    </div>
  );
}
