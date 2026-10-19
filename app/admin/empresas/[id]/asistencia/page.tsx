import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { initDb, prisma } from "@/lib/db";
import {
  companyAttendanceView,
  companyAttendanceHiddenCount,
  companyAttendanceSites,
  attendanceDedupSeconds,
  type AttendanceViewRow,
} from "@/lib/companyAttendance";
import { Tag } from "@/components/ui/Tag";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { DisabledBtn } from "@/components/ui/Btn";
import { AttendanceExportButton } from "@/components/admin/AttendanceExportButton";
import { RecomputeAttendanceButton } from "@/components/admin/RecomputeAttendanceButton";
import { AttendanceDaysView, AttendanceViewSwitch } from "./DaysView";
import { Tip } from "@/components/ui/IconBtn";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { MultiOpButton } from "@/components/admin/MultiOpButton";
import { Icon } from "@/components/ui/icons";
import { syncCompanyAttendanceAction } from "@/app/admin/actions";
import { formatIoTime } from "@/lib/ioTime";
import { UrlFilters } from "@/components/admin/UrlFilters";
import { filterSummary } from "@/lib/filterSummary";
import { withReturn } from "@/lib/returnTo";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 300;

/**
 * Empresa > Asistencia (docs/11 C4): lo MISMO que se exporta a nómina — las
 * marcaciones de las personas con contrato en esta empresa, en cualquier equipo
 * de su alcance, dentro del período de su contrato (lib/companyAttendance).
 * Lo marcado en un equipo sin importar de quién es (IDs sin empleado incluidos)
 * está en Equipo → Marcaciones. Las repetidas a menos de la ventana de la
 * anterior de la misma persona no se muestran ni se exportan (attendanceDedupSeconds).
 */
export default async function EmpresaAsistenciaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string; to?: string; sede?: string; vista?: string; estado?: string }>;
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

  // "Por día" (docs/16): los días calculados por el motor, con su propio filtro.
  const vista = f.vista === "dias" ? "dias" : "marcaciones";
  const switcher = <AttendanceViewSwitch companyId={company.id} vista={vista} from={f.from} to={f.to} />;
  if (vista === "dias") {
    return (
      <div className="flex max-w-5xl flex-col gap-4">
        <CompanyTabs
          companyId={company.id}
          companyName={company.name}
          active="asistencia"
          actions={<RecomputeAttendanceButton companyId={company.id} from={f.from} to={f.to} />}
        />
        {switcher}
        <AttendanceDaysView companyId={company.id} from={f.from} to={f.to} estado={f.estado} />
      </div>
    );
  }

  const siteId = f.sede && Number.isFinite(Number(f.sede)) ? Number(f.sede) : null;
  const filters = { from: f.from, to: f.to, siteId, withUnmatched: true };
  const [rows, sites, hidden] = await Promise.all([
    companyAttendanceView(id, { ...filters, limit: RESULT_LIMIT + 1 }),
    companyAttendanceSites(id),
    companyAttendanceHiddenCount(id, filters),
  ]);
  const dedupMin = Math.round(attendanceDedupSeconds() / 60);
  const truncated = rows.length > RESULT_LIMIT;
  const logs = rows.slice(0, RESULT_LIMIT);
  const unmatchedShown = logs.filter((r) => r.employee_id == null).length;
  const foreign = (companyId: number, companyName: string) => (companyId === id ? "" : ` (${companyName})`);

  // Export (docs/11 R8): exactamente lo filtrado en pantalla; exige rango. Antes de
  // descargar avisa de marcaciones de IDs sin empleado (R10).
  const exportParams = new URLSearchParams();
  if (f.from) exportParams.set("from", f.from);
  if (f.to) exportParams.set("to", f.to);
  if (siteId != null) exportParams.set("sede", String(siteId));
  const canExport = Boolean(f.from && f.to);
  const exportAction = (
    <span className="group/tip relative inline-flex">
      {canExport ? (
        <AttendanceExportButton
          companyId={company.id}
          href={`/admin/empresas/${company.id}/asistencia/export?${exportParams.toString()}`}
          from={f.from!}
          to={f.to!}
          sede={siteId}
        />
      ) : (
        <DisabledBtn variant="icon">{Icon.export}</DisabledBtn>
      )}
      <Tip label={canExport ? "Exportar a Excel (Galepso)" : "Elija desde y hasta para exportar"} />
    </span>
  );

  // Al abrir a una persona, "volver" regresa acá con los mismos filtros.
  const backHere = `/admin/empresas/${company.id}/asistencia${exportParams.size > 0 ? `?${exportParams.toString()}` : ""}`;
  // Sin empleado (docs/11 R11): el ID del equipo bien visible — si es una cédula
  // real, alcanza para saber quién falta registrar.
  const person = (r: AttendanceViewRow) =>
    r.employee_id == null ? (
      <span className="inline-flex flex-wrap items-center gap-2">
        <span>{r.device_user_name || <span className="text-text/60">Sin nombre en el equipo</span>}</span>
        <Tag variant="neutral">Sin empleado</Tag>
      </span>
    ) : (
      <Link href={withReturn(`/admin/empleados/${r.employee_id}`, backHere)} className="text-accent no-underline hover:underline">
        {r.last_name}, {r.first_name}
      </Link>
    );
  const idCell = (r: AttendanceViewRow) =>
    r.employee_id == null ? <span title="ID en el equipo (no es la cédula de ningún empleado registrado)">ID {r.user_id}</span> : r.national_id;

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <CompanyTabs
        companyId={company.id}
        companyName={company.name}
        active="asistencia"
        actions={
          <>
            {exportAction}
            <RecomputeAttendanceButton companyId={company.id} from={f.from} to={f.to} />
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
      {switcher}

      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-sm text-text/75">
          {filterSummary(
            f.from,
            f.to,
            siteId != null ? `Sede ${sites.find((s) => s.id === siteId)?.name ?? ""}` : null
          )}
          {hidden > 0 && (
            <span title="Marcaciones de la misma persona a menos de esa ventana de la anterior, en cualquier equipo. Siguen guardadas; no se muestran ni se exportan.">
              {" "}· {hidden} repetida{hidden === 1 ? "" : "s"} (menos de {dedupMin} min) sin mostrar
            </span>
          )}
        </p>
        <Suspense fallback={<div className="h-(--control-h) w-(--control-h)" />}>
          <UrlFilters
            fields={[
              { name: "from", label: "Desde", type: "date" },
              { name: "to", label: "Hasta", type: "date" },
              {
                name: "sede",
                label: "Sede",
                type: "select",
                emptyLabel: "todas",
                options: sites.map((s) => ({
                  value: String(s.id),
                  label: `${s.name}${foreign(s.company_id, s.company.name)}${s.status !== "active" ? " — inactiva" : ""}`,
                })),
              },
            ]}
          />
        </Suspense>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="Sin marcaciones para estos filtros"
          description="Pruebe con otro rango de fechas o sede. Aparecen las marcaciones de personas con contrato en esta empresa (dentro del período del contrato) y las de IDs de sus equipos que no son de ningún empleado."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Persona</Th>
                  <Th>Cédula / ID</Th>
                  <Th>Sede</Th>
                  <Th>Equipo</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono">{formatIoTime(r.io_time)}</Td>
                    <Td>{person(r)}</Td>
                    <Td className="font-mono text-xs">{idCell(r)}</Td>
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
                title={r.employee_id == null ? `${r.device_user_name || "Sin nombre"} · sin empleado` : `${r.last_name}, ${r.first_name}`}
                tags={<span className="font-mono text-xs text-text/60">{formatIoTime(r.io_time)}</span>}
                fields={[
                  { label: "Sede", value: r.site_name },
                  { label: "Equipo", value: r.device_name },
                  r.employee_id == null ? { label: "ID en equipo", value: r.user_id } : { label: "Cédula", value: r.national_id ?? "" },
                ]}
              />
            ))}
          </MobileList>
          <p className="m-0 text-xs text-text/70">
            {logs.length} marcación{logs.length === 1 ? "" : "es"}
            {truncated ? ` (mostrando las ${RESULT_LIMIT} más recientes)` : ""} · por contrato: es lo que se exporta a
            nómina.
            {unmatchedShown > 0 &&
              ` Las «Sin empleado» (${unmatchedShown}) son IDs del equipo que no son la cédula de nadie registrado: no salen en el export salvo que al exportar elijas de quién son.`}
          </p>
        </>
      )}
    </div>
  );
}
