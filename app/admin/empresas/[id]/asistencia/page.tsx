import Link from "next/link";
import { notFound } from "next/navigation";
import { allAsync, initDb, prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { Btn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { MultiOpButton } from "@/components/admin/MultiOpButton";
import { syncCompanyAttendanceAction } from "@/app/admin/actions";
import { toDayBound, formatIoTime } from "@/lib/ioTime";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 300;

interface Row {
  id: number;
  io_time: string | null;
  user_id: string;
  employee_id: number | null;
  employee_name: string | null;
  device_user_name: string | null;
  device_name: string;
  site_name: string;
}

/**
 * Empresa > Asistencia (docs/10 §6, R12): marcaciones hechas en los equipos de
 * las sedes de ESTA empresa — el marcaje pertenece a la empresa donde se marca,
 * aunque la persona tenga su contrato en otra empresa del grupo. El día procesado
 * y la exportación se imputan al contrato (Hito 4/5).
 */
export default async function EmpresaAsistenciaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; sede?: string }>;
}) {
  await requireUser();
  await initDb();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const f = await searchParams;

  const company = await prisma.client_company.findUnique({
    where: { id },
    select: { id: true, name: true, sites: { select: { id: true, name: true }, orderBy: { name: "asc" } } },
  });
  if (!company) notFound();

  const conditions = ["s.company_id = ?"];
  const args: unknown[] = [id];
  const siteId = f.sede ? Number(f.sede) : null;
  if (siteId && Number.isFinite(siteId)) {
    conditions.push("s.id = ?");
    args.push(siteId);
  }
  if (f.from) {
    conditions.push("al.io_time >= ?");
    args.push(toDayBound(f.from, "start"));
  }
  if (f.to) {
    conditions.push("al.io_time <= ?");
    args.push(toDayBound(f.to, "end"));
  }

  // Persona: por el employee_id ya resuelto, o por cédula = user_id (docs/10 §4.6).
  const rows = await allAsync<Row>(
    `SELECT al.id, al.io_time, al.user_id,
            COALESCE(al.employee_id, e.id) AS employee_id,
            COALESCE(e1.last_name || ', ' || e1.first_name, e.last_name || ', ' || e.first_name) AS employee_name,
            u.user_name AS device_user_name,
            COALESCE(d.fk_name, d.dev_id) AS device_name,
            s.name AS site_name
       FROM attendance_logs al
       JOIN devices d ON d.dev_id = al.dev_id
       JOIN site s ON s.id = d.site_id
       LEFT JOIN employee e1 ON e1.id = al.employee_id
       LEFT JOIN employee e ON al.employee_id IS NULL AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id
       LEFT JOIN users u ON u.dev_id = al.dev_id AND u.user_id = al.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY al.io_time DESC
      LIMIT ${RESULT_LIMIT + 1}`,
    args
  );
  const truncated = rows.length > RESULT_LIMIT;
  const logs = rows.slice(0, RESULT_LIMIT);

  const person = (r: Row) =>
    r.employee_id ? (
      <Link href={`/admin/empleados/${r.employee_id}`} className="text-accent no-underline hover:underline">
        {r.employee_name}
      </Link>
    ) : (
      <span>
        {r.device_user_name || r.user_id} <Tag variant="neutral">sin empleado</Tag>
      </span>
    );

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <CompanyTabs companyId={company.id} companyName={company.name} active="asistencia" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className={LABEL}>
            Desde
            <input type="date" name="from" defaultValue={f.from ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Hasta
            <input type="date" name="to" defaultValue={f.to ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Sede
            <select name="sede" defaultValue={f.sede ?? ""} className={INPUT}>
              <option value="">todas</option>
              {company.sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <Btn type="submit" variant="secondary">
            Filtrar
          </Btn>
        </form>
        <MultiOpButton
          action={syncCompanyAttendanceAction}
          hidden={{ company_id: String(company.id) }}
          title="Sincronizar asistencia"
          description="Trae de los equipos de las sedes de esta empresa las marcaciones desde la última sincronización. Normalmente no hace falta: las marcaciones llegan solas en el momento, y si un equipo estuvo sin red las reenvía al reconectar."
        >
          Sincronizar asistencia
        </MultiOpButton>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="Sin marcaciones para estos filtros"
          description="Probá con otro rango de fechas o sede. Solo aparecen marcaciones de equipos asignados a sedes de esta empresa."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Persona</Th>
                  <Th>ID en equipo</Th>
                  <Th>Sede</Th>
                  <Th>Equipo</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono">{formatIoTime(r.io_time)}</Td>
                    <Td>{person(r)}</Td>
                    <Td className="font-mono text-xs">{r.user_id}</Td>
                    <Td>{r.site_name}</Td>
                    <Td>{r.device_name}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {logs.map((r) => (
              <MobileRow
                key={r.id}
                title={r.employee_name ?? r.device_user_name ?? r.user_id}
                tags={<span className="font-mono text-xs text-text/60">{formatIoTime(r.io_time)}</span>}
                fields={[
                  { label: "Sede", value: r.site_name },
                  { label: "Equipo", value: r.device_name },
                  { label: "ID", value: r.user_id },
                ]}
              />
            ))}
          </MobileList>
          <p className="m-0 text-xs text-text/70">
            {logs.length} marcación{logs.length === 1 ? "" : "es"}
            {truncated ? ` (mostrando las ${RESULT_LIMIT} más recientes)` : ""}.
          </p>
        </>
      )}
    </div>
  );
}
