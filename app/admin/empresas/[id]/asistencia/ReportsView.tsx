import Link from "next/link";
import { Suspense } from "react";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { DownloadBtn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { UrlFilters } from "@/components/admin/UrlFilters";
import { PeriodPresets } from "@/components/admin/PeriodPresets";
import { formatMinutes } from "@/lib/shiftTime";
import { withReturn } from "@/lib/returnTo";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { defaultComputeRange } from "@/lib/attendance/engine";
import {
  companyIncidents,
  companySummary,
  INCIDENT_LABEL,
  type IncidentKind,
  type SummaryRow,
} from "@/lib/attendance/reports";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fmtDay = (ymd: string) => `${WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()]} ${fmtYmd(ymd)}`;
const fmtMin = (m: number) => (m ? formatMinutes(m) : "—");
const countMin = (n: number, min: number) => (n ? `${n} · ${formatMinutes(min)}` : "—");

type ReportVista = "consolidado" | "incidencias";

function resolveRange(fromRaw?: string, toRaw?: string) {
  const def = defaultComputeRange();
  return {
    from: fromRaw && YMD.test(fromRaw) ? fromRaw : def.from,
    to: toRaw && YMD.test(toRaw) ? toRaw : def.to,
  };
}

/** Período, atajos de quincena/mes, filtros y descarga — común a los dos reportes. */
function ReportHeader({
  companyId,
  vista,
  from,
  to,
  explicit,
  extraFilters,
  extraParams,
  info,
}: {
  companyId: number;
  vista: ReportVista;
  from: string;
  to: string;
  explicit: boolean;
  extraFilters?: Parameters<typeof UrlFilters>[0]["fields"];
  extraParams?: Record<string, string>;
  info?: React.ReactNode;
}) {
  const today = dateKeyInTz(new Date(), DEFAULT_TZ);
  const download = `/admin/empresas/${companyId}/asistencia/reporte?${new URLSearchParams({ tipo: vista, from, to }).toString()}`;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 text-sm text-text/75">
          <span>
            Del {fmtYmd(from)} al {fmtYmd(to)}
            {!explicit && " (últimos días cerrados)"}
          </span>
          {to >= today && <span className="text-xs">El día de hoy y los siguientes todavía no están calculados.</span>}
          {info}
        </div>
        <div className="flex items-start gap-2">
          <Suspense fallback={<div className="h-(--control-h) w-(--control-h)" />}>
            <UrlFilters
              fields={[
                { name: "from", label: "Desde", type: "date" },
                { name: "to", label: "Hasta", type: "date" },
                ...(extraFilters ?? []),
              ]}
            />
          </Suspense>
          <DownloadBtn href={download} variant="primary">
            Descargar .xlsx
          </DownloadBtn>
        </div>
      </div>
      <PeriodPresets basePath={`/admin/empresas/${companyId}/asistencia`} from={from} to={to} keep={{ vista, ...extraParams }} />
    </div>
  );
}

/**
 * Empresa → Asistencia → Consolidado (Hito 5, docs/17): por contrato, los totales
 * del período como insumo de nómina. Sale de los días calculados por el motor.
 */
export async function AttendanceSummaryView({ companyId, from: fromRaw, to: toRaw }: { companyId: number; from?: string; to?: string }) {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const rows = await companySummary(companyId, from, to);
  const computed = rows.some((r) => r.workdays || r.daysWorked || r.absences || r.incomplete || r.noScheduleDays);
  const total = rows.reduce(
    (t, r) => ({
      workdays: t.workdays + r.workdays,
      daysWorked: t.daysWorked + r.daysWorked,
      worked: t.worked + r.workedMinutes,
      overtime: t.overtime + r.overtimeMinutes,
      lates: t.lates + r.lates,
      lateMin: t.lateMin + r.lateMinutes,
      earlies: t.earlies + r.earlyLeaves,
      earlyMin: t.earlyMin + r.earlyLeaveMinutes,
      absences: t.absences + r.absences,
      incomplete: t.incomplete + r.incomplete,
    }),
    { workdays: 0, daysWorked: 0, worked: 0, overtime: 0, lates: 0, lateMin: 0, earlies: 0, earlyMin: 0, absences: 0, incomplete: 0 }
  );
  const back = `/admin/empresas/${companyId}/asistencia?${new URLSearchParams({ vista: "consolidado", from, to }).toString()}`;
  const personHref = (r: SummaryRow) =>
    withReturn(`/admin/empleados/${r.employeeId}/asistencia?${new URLSearchParams({ from, to }).toString()}`, back);

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        companyId={companyId}
        vista="consolidado"
        from={from}
        to={to}
        explicit={!!(fromRaw || toRaw)}
        info={
          rows.length > 0 && (
            <span className="text-xs">
              {rows.length} contrato(s). Horas extra solo de referencia, sin recargos legales. Los días incompletos (una sola
              marcación) no suman horas.
            </span>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState title="Ningún contrato vigente en este período" description="Pruebe con otro rango de fechas." />
      ) : !computed ? (
        <EmptyState
          title="Todavía no hay días calculados en este período"
          description="La asistencia se calcula cada noche. Para no esperar, use “Recalcular asistencia” arriba."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Persona</Th>
                  <Th>Días trabajados</Th>
                  <Th>Horas</Th>
                  <Th>Extra</Th>
                  <Th>Tardanzas</Th>
                  <Th>Salidas antic.</Th>
                  <Th>Ausencias</Th>
                  <Th>Incompletos</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.employmentId}>
                    <Td>
                      <Link href={personHref(r)} className="whitespace-nowrap text-accent no-underline hover:underline">
                        {r.name}
                      </Link>
                      <div className="whitespace-nowrap text-xs text-text/60">
                        <span className="font-mono">{r.nationalId}</span>
                        {r.scheduleName ? "" : " · sin horario"}
                        {r.corrections ? ` · ${r.corrections === 1 ? "1 corrección" : `${r.corrections} correcciones`}` : ""}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {r.daysWorked}
                      {r.workdays ? <span className="text-text/60"> de {r.workdays}</span> : null}
                    </Td>
                    <Td className="whitespace-nowrap">{fmtMin(r.workedMinutes)}</Td>
                    <Td className="whitespace-nowrap">{fmtMin(r.overtimeMinutes)}</Td>
                    <Td className="whitespace-nowrap">{countMin(r.lates, r.lateMinutes)}</Td>
                    <Td className="whitespace-nowrap">{countMin(r.earlyLeaves, r.earlyLeaveMinutes)}</Td>
                    <Td>{r.absences || "—"}</Td>
                    <Td>{r.incomplete || "—"}</Td>
                  </Tr>
                ))}
                <Tr>
                  <Td className="font-semibold">Total</Td>
                  <Td className="whitespace-nowrap font-semibold">
                    {total.daysWorked}
                    {total.workdays ? <span className="font-normal text-text/60"> de {total.workdays}</span> : null}
                  </Td>
                  <Td className="whitespace-nowrap font-semibold">{fmtMin(total.worked)}</Td>
                  <Td className="whitespace-nowrap font-semibold">{fmtMin(total.overtime)}</Td>
                  <Td className="whitespace-nowrap font-semibold">{countMin(total.lates, total.lateMin)}</Td>
                  <Td className="whitespace-nowrap font-semibold">{countMin(total.earlies, total.earlyMin)}</Td>
                  <Td className="font-semibold">{total.absences || "—"}</Td>
                  <Td className="font-semibold">{total.incomplete || "—"}</Td>
                </Tr>
              </tbody>
            </Table>
          </div>
          <MobileList>
            {rows.map((r) => (
              <MobileRow
                key={r.employmentId}
                title={r.name}
                href={personHref(r)}
                tags={<span className="font-mono text-xs text-text/60">{r.nationalId}</span>}
                fields={[
                  { label: "Días trabajados", value: r.workdays ? `${r.daysWorked} de ${r.workdays}` : String(r.daysWorked) },
                  { label: "Horas / extra", value: `${fmtMin(r.workedMinutes)} / ${fmtMin(r.overtimeMinutes)}` },
                  { label: "Tardanzas", value: countMin(r.lates, r.lateMinutes) },
                  { label: "Salidas antic.", value: countMin(r.earlyLeaves, r.earlyLeaveMinutes) },
                  { label: "Ausencias / incompletos", value: `${r.absences} / ${r.incomplete}` },
                ]}
              />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}

const KINDS = Object.keys(INCIDENT_LABEL) as IncidentKind[];
const KIND_VARIANT: Record<IncidentKind, "accent" | "accent2" | "neutral" | "outline"> = {
  late: "accent2",
  early_leave: "accent2",
  absent: "accent2",
  incomplete: "neutral",
  mark_added: "outline",
  mark_voided: "outline",
};

/**
 * Empresa → Asistencia → Incidencias (Hito 5, docs/17): tardanzas, salidas
 * anticipadas, ausencias, días incompletos y correcciones manuales del período.
 */
export async function AttendanceIncidentsView({
  companyId,
  from: fromRaw,
  to: toRaw,
  tipo,
}: {
  companyId: number;
  from?: string;
  to?: string;
  tipo?: string;
}) {
  const { from, to } = resolveRange(fromRaw, toRaw);
  const kind = KINDS.includes(tipo as IncidentKind) ? (tipo as IncidentKind) : null;
  const all = await companyIncidents(companyId, from, to);
  const rows = kind ? all.filter((r) => r.kind === kind) : all;
  const counts = new Map<IncidentKind, number>();
  for (const r of all) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  const back = `/admin/empresas/${companyId}/asistencia?${new URLSearchParams({ vista: "incidencias", from, to, ...(kind ? { tipo: kind } : {}) }).toString()}`;
  const personHref = (employeeId: number) =>
    withReturn(`/admin/empleados/${employeeId}/asistencia?${new URLSearchParams({ from, to }).toString()}`, back);
  const detail = (r: (typeof rows)[number]) => {
    if (r.kind === "late") return `${r.minutes} min tarde`;
    if (r.kind === "early_leave") return `salió ${r.minutes} min antes`;
    if (r.kind === "incomplete") return r.time ? `solo marcó a las ${r.time}` : "una sola marcación";
    if (r.kind === "absent") return "sin marcaciones";
    return (
      <span className="flex flex-col">
        <span>a las {r.time}</span>
        <span className="text-xs text-text/70">
          {r.actor}: “{r.reason}”
        </span>
      </span>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        companyId={companyId}
        vista="incidencias"
        from={from}
        to={to}
        explicit={!!(fromRaw || toRaw)}
        extraParams={kind ? { tipo: kind } : undefined}
        extraFilters={[
          { name: "tipo", label: "Incidencia", type: "select", emptyLabel: "todas", options: KINDS.map((k) => ({ value: k, label: INCIDENT_LABEL[k] })) },
        ]}
        info={
          all.length > 0 && (
            <span className="text-xs">
              {KINDS.filter((k) => counts.get(k))
                .map((k) => `${INCIDENT_LABEL[k]}: ${counts.get(k)}`)
                .join(" · ")}
            </span>
          )
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title={all.length === 0 ? "Sin incidencias en este período" : "Ninguna incidencia de ese tipo"}
          description={
            all.length === 0
              ? "Si el período todavía no se calculó, use “Recalcular asistencia” arriba. Los contratos sin horario no tienen tardanzas ni ausencias."
              : "Pruebe con otro tipo o rango de fechas."
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha</Th>
                  <Th>Persona</Th>
                  <Th>Incidencia</Th>
                  <Th>Detalle</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <Tr key={`${r.employmentId}-${r.date}-${r.kind}-${i}`}>
                    <Td className="whitespace-nowrap font-mono text-xs">{fmtDay(r.date)}</Td>
                    <Td>
                      <Link href={personHref(r.employeeId)} className="text-accent no-underline hover:underline">
                        {r.name}
                      </Link>
                    </Td>
                    <Td>
                      <Tag variant={KIND_VARIANT[r.kind]}>{INCIDENT_LABEL[r.kind]}</Tag>
                    </Td>
                    <Td>{detail(r)}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {rows.map((r, i) => (
              <MobileRow
                key={`${r.employmentId}-${r.date}-${r.kind}-${i}`}
                title={r.name}
                href={personHref(r.employeeId)}
                tags={<span className="font-mono text-xs text-text/60">{fmtDay(r.date)}</span>}
                fields={[
                  { label: "Incidencia", value: <Tag variant={KIND_VARIANT[r.kind]}>{INCIDENT_LABEL[r.kind]}</Tag> },
                  { label: "Detalle", value: detail(r) },
                ]}
              />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}
