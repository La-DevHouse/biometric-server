import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { cx } from "@/lib/cx";
import { EmptyState } from "@/components/ui/EmptyState";
import { UrlFilters } from "@/components/admin/UrlFilters";
import { AttendanceDaysTable } from "@/components/admin/AttendanceDaysTable";
import { companyAttendanceDays, companyAttendanceDayCounts } from "@/lib/attendance/queries";
import { defaultComputeRange } from "@/lib/attendance/engine";
import { DAY_STATUS_LABEL, statusCount } from "@/lib/attendance/labels";
import type { DayStatus } from "@/lib/attendance/compute";
import { withReturn } from "@/lib/returnTo";

const LIMIT = 500;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = Object.keys(DAY_STATUS_LABEL) as DayStatus[];
const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/** Selector "Marcaciones / Por día" de Empresa → Asistencia (conserva el rango). */
export function AttendanceViewSwitch({
  companyId,
  vista,
  from,
  to,
}: {
  companyId: number;
  vista: "marcaciones" | "dias";
  from?: string;
  to?: string;
}) {
  const qs = (v: string | null) => {
    const p = new URLSearchParams();
    if (v) p.set("vista", v);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    const s = p.toString();
    return `/admin/empresas/${companyId}/asistencia${s ? `?${s}` : ""}`;
  };
  const item = (key: "marcaciones" | "dias", label: string, href: string) => (
    <Link
      href={href}
      aria-current={vista === key ? "page" : undefined}
      className={cx(
        "border px-3 py-1.5 text-sm no-underline",
        vista === key ? "border-text bg-text font-semibold text-white" : "border-neutral-400 text-text hover:border-text"
      )}
    >
      {label}
    </Link>
  );
  return (
    <div className="flex gap-0" role="tablist" aria-label="Vista de asistencia">
      {item("marcaciones", "Marcaciones", qs(null))}
      {item("dias", "Por día", qs("dias"))}
    </div>
  );
}

/**
 * Empresa → Asistencia → Por día (docs/16): los días calculados por el motor —
 * entrada, salida, horas, extra y estado de cada persona. Sin rango, los
 * últimos días cerrados (los mismos que recalcula la corrida nocturna).
 */
export async function AttendanceDaysView({
  companyId,
  from: fromRaw,
  to: toRaw,
  estado,
}: {
  companyId: number;
  from?: string;
  to?: string;
  estado?: string;
}) {
  const def = defaultComputeRange();
  const from = fromRaw && YMD.test(fromRaw) ? fromRaw : def.from;
  const to = toRaw && YMD.test(toRaw) ? toRaw : def.to;
  const status = STATUSES.includes(estado as DayStatus) ? (estado as DayStatus) : null;

  const [rows, counts, withoutSchedule] = await Promise.all([
    companyAttendanceDays(companyId, { from, to, status, limit: LIMIT + 1 }),
    companyAttendanceDayCounts(companyId, from, to),
    prisma.employment.count({ where: { company_id: companyId, end_date: null, schedule_group_id: null } }),
  ]);
  const truncated = rows.length > LIMIT;
  const days = rows.slice(0, LIMIT);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);

  const back = new URLSearchParams({ vista: "dias" });
  if (fromRaw) back.set("from", fromRaw);
  if (toRaw) back.set("to", toRaw);
  if (status) back.set("estado", status);
  const backHere = `/admin/empresas/${companyId}/asistencia?${back.toString()}`;

  const summary = STATUSES.filter((s) => counts.get(s)).map((s) => statusCount(s, counts.get(s)!));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1 text-sm text-text/75">
          <span>
            Del {fmtYmd(from)} al {fmtYmd(to)}
            {!fromRaw && !toRaw && " (últimos días cerrados)"}
            {total > 0 && ` · ${total} día(s): ${summary.join(", ")}`}
          </span>
          {withoutSchedule > 0 && (
            <span className="text-xs">
              {withoutSchedule} contrato(s) vigente(s) sin horario: esas personas solo tienen horas, sin tardanzas ni
              ausencias. Asígneles uno en{" "}
              <Link href={`/admin/empresas/${companyId}/empleados`} className="text-accent no-underline hover:underline">
                Empleados
              </Link>
              .
            </span>
          )}
        </div>
        <Suspense fallback={<div className="h-(--control-h) w-(--control-h)" />}>
          <UrlFilters
            fields={[
              { name: "from", label: "Desde", type: "date" },
              { name: "to", label: "Hasta", type: "date" },
              {
                name: "estado",
                label: "Estado",
                type: "select",
                emptyLabel: "todos",
                options: STATUSES.map((s) => ({ value: s, label: DAY_STATUS_LABEL[s] })),
              },
            ]}
          />
        </Suspense>
      </div>

      {days.length === 0 ? (
        <EmptyState
          title={total === 0 ? "Todavía no hay días calculados en este período" : "Ningún día con ese estado"}
          description={
            total === 0
              ? "La asistencia se calcula cada noche. Para no esperar, use “Recalcular asistencia” arriba. El día de hoy se calcula mañana."
              : "Pruebe con otro estado o rango de fechas."
          }
        />
      ) : (
        <>
          <AttendanceDaysTable
            rows={days}
            show="person"
            personHref={(r) => withReturn(`/admin/empleados/${r.employeeId}/asistencia`, backHere)}
          />
          {truncated && (
            <p className="m-0 text-xs text-text/70">Mostrando los {LIMIT} más recientes: acote el rango o filtre por estado.</p>
          )}
        </>
      )}
    </div>
  );
}
