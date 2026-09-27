import Link from "next/link";
import { notFound } from "next/navigation";
import { initDb, prisma } from "@/lib/db";
import {
  companyAttendance,
  companyAttendanceSites,
  type CompanyAttendanceRow,
} from "@/lib/companyAttendance";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Btn, DownloadBtn, DisabledBtn } from "@/components/ui/Btn";
import { Tip } from "@/components/ui/IconBtn";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { MultiOpButton } from "@/components/admin/MultiOpButton";
import { Icon } from "@/components/ui/icons";
import { syncCompanyAttendanceAction } from "@/app/admin/actions";
import { formatIoTime } from "@/lib/ioTime";
import {
  FIELD_INPUT as INPUT,
  FIELD_LABEL as LABEL,
} from "@/components/ui/fieldStyles";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 300;

/**
 * Empresa > Asistencia (docs/11 C4): lo MISMO que se exporta a nómina — las
 * marcaciones de las personas con contrato en esta empresa, en cualquier equipo
 * de su alcance, dentro del período de su contrato (lib/companyAttendance).
 * Lo marcado en un equipo sin importar de quién es (IDs sin empleado incluidos)
 * está en Equipo → Marcaciones.
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
    select: { id: true, name: true },
  });
  if (!company) notFound();

  const siteId =
    f.sede && Number.isFinite(Number(f.sede)) ? Number(f.sede) : null;
  const [rows, sites] = await Promise.all([
    companyAttendance(id, {
      from: f.from,
      to: f.to,
      siteId,
      limit: RESULT_LIMIT + 1,
    }),
    companyAttendanceSites(id),
  ]);
  const truncated = rows.length > RESULT_LIMIT;
  const logs = rows.slice(0, RESULT_LIMIT);
  const foreign = (companyId: number, companyName: string) =>
    companyId === id ? "" : ` (${companyName})`;

  // Export (docs/11 R8): exactamente lo filtrado en pantalla; exige rango.
  const exportParams = new URLSearchParams();
  if (f.from) exportParams.set("from", f.from);
  if (f.to) exportParams.set("to", f.to);
  if (siteId != null) exportParams.set("sede", String(siteId));
  const canExport = Boolean(f.from && f.to);
  const exportAction = (
    <span className="group/tip relative inline-flex">
      {canExport ? (
        <DownloadBtn
          variant="icon"
          href={`/admin/empresas/${company.id}/asistencia/export?${exportParams.toString()}`}
          aria-label="Exportar a Excel (Galepso)"
        >
          {Icon.export}
        </DownloadBtn>
      ) : (
        <DisabledBtn variant="icon">{Icon.export}</DisabledBtn>
      )}
      <Tip
        label={
          canExport
            ? "Exportar a Excel (Galepso)"
            : "Elegí desde y hasta para exportar"
        }
      />
    </span>
  );

  const person = (r: CompanyAttendanceRow) => (
    <Link
      href={`/admin/empleados/${r.employee_id}`}
      className="text-accent no-underline hover:underline"
    >
      {r.last_name}, {r.first_name}
    </Link>
  );

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <CompanyTabs
        companyId={company.id}
        companyName={company.name}
        active="asistencia"
        actions={
          <>
            {exportAction}
            <MultiOpButton
              action={syncCompanyAttendanceAction}
              hidden={{ company_id: String(company.id) }}
              title="Sincronizar asistencia"
              variant="icon"
              description="Trae de los equipos de las sedes de esta empresa las marcaciones desde la última sincronización. Normalmente no hace falta: las marcaciones llegan solas en el momento, y si un equipo estuvo sin red las reenvía al reconectar."
            >
              {Icon.sync}
            </MultiOpButton>
          </>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className={LABEL}>
            Desde
            <input
              type="date"
              name="from"
              defaultValue={f.from ?? ""}
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            Hasta
            <input
              type="date"
              name="to"
              defaultValue={f.to ?? ""}
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            Sede
            <select name="sede" defaultValue={f.sede ?? ""} className={INPUT}>
              <option value="">todas</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {foreign(s.company_id, s.company.name)}
                  {s.status !== "active" ? " — inactiva" : ""}
                </option>
              ))}
            </select>
          </label>
          <Btn type="submit" variant="secondary">
            Filtrar
          </Btn>
        </form>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="Sin marcaciones para estos filtros"
          description="Probá con otro rango de fechas o sede. Solo aparecen marcaciones de personas con contrato en esta empresa, hechas dentro del período de su contrato."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Persona</Th>
                  <Th>Cédula</Th>
                  <Th>Sede</Th>
                  <Th>Equipo</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono">{formatIoTime(r.io_time)}</Td>
                    <Td>{person(r)}</Td>
                    <Td className="font-mono text-xs">{r.national_id}</Td>
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
                title={`${r.last_name}, ${r.first_name}`}
                tags={
                  <span className="font-mono text-xs text-text/60">
                    {formatIoTime(r.io_time)}
                  </span>
                }
                fields={[
                  { label: "Sede", value: r.site_name },
                  { label: "Equipo", value: r.device_name },
                  { label: "Cédula", value: r.national_id },
                ]}
              />
            ))}
          </MobileList>
          <p className="m-0 text-xs text-text/70">
            {logs.length} marcación{logs.length === 1 ? "" : "es"}
            {truncated
              ? ` (mostrando las ${RESULT_LIMIT} más recientes)`
              : ""}{" "}
            · por contrato: es lo que se exporta a nómina. Lo marcado en un
            equipo por cualquier ID está en Equipos → Marcaciones.
          </p>
        </>
      )}
    </div>
  );
}
