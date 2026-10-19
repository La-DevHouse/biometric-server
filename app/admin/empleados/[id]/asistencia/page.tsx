import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeTabs } from "@/components/admin/EmployeeTabs";
import { UrlFilters } from "@/components/admin/UrlFilters";
import { AttendanceDaysTable } from "@/components/admin/AttendanceDaysTable";
import { employeeAttendanceDays } from "@/lib/attendance/queries";
import { defaultComputeRange } from "@/lib/attendance/engine";
import { DAY_STATUS_LABEL, statusCount } from "@/lib/attendance/labels";
import type { DayStatus } from "@/lib/attendance/compute";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

/**
 * Empleado → Asistencia (docs/16): sus días calculados por el motor, en todas las
 * empresas donde tiene contrato. Sin rango, los últimos días cerrados.
 */
export default async function EmpleadoAsistenciaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ volver?: string; from?: string; to?: string }>;
}) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const sp = await searchParams;

  const def = defaultComputeRange();
  const from = sp.from && YMD.test(sp.from) ? sp.from : def.from;
  const to = sp.to && YMD.test(sp.to) ? sp.to : def.to;
  const days = await employeeAttendanceDays(id, { from, to });

  const counts = new Map<DayStatus, number>();
  for (const d of days) if (d.status) counts.set(d.status, (counts.get(d.status) ?? 0) + 1);
  const worked = days.reduce((n, d) => n + (d.workedMinutes ?? 0), 0);
  const overtime = days.reduce((n, d) => n + (d.overtimeMinutes ?? 0), 0);
  const summary = (Object.keys(DAY_STATUS_LABEL) as DayStatus[]).filter((s) => counts.get(s)).map((s) => statusCount(s, counts.get(s)!));

  return (
    <div className="flex max-w-5xl flex-col gap-4">
      <EmployeeTabs employeeId={id} active="asistencia" returnTo={sp.volver} />

      <div className="flex items-start justify-between gap-3">
        <p className="m-0 text-sm text-text/75">
          Del {fmtYmd(from)} al {fmtYmd(to)}
          {!sp.from && !sp.to && " (últimos días cerrados)"}
          {days.length > 0 &&
            ` · ${summary.join(", ")} · ${Math.floor(worked / 60)} h trabajadas${overtime ? `, ${Math.floor(overtime / 60)} h ${overtime % 60} min extra` : ""}`}
        </p>
        <Suspense fallback={<div className="h-(--control-h) w-(--control-h)" />}>
          <UrlFilters
            fields={[
              { name: "from", label: "Desde", type: "date" },
              { name: "to", label: "Hasta", type: "date" },
            ]}
          />
        </Suspense>
      </div>

      {days.length === 0 ? (
        <EmptyState
          title="Sin días calculados en este período"
          description="La asistencia se calcula cada noche (o con “Recalcular asistencia” en la empresa). El día de hoy se calcula mañana."
        />
      ) : (
        <AttendanceDaysTable rows={days} show="company" />
      )}
    </div>
  );
}
