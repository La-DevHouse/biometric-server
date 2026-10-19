import Link from "next/link";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { DEFAULT_TZ, dateKeyInTz } from "@/lib/time";
import { formatMinutes } from "@/lib/shiftTime";
import { DAY_STATUS_LABEL } from "@/lib/attendance/labels";
import type { AttendanceDayRow } from "@/lib/attendance/queries";
import type { DayStatus } from "@/lib/attendance/compute";
import { CorrectDayDialog } from "./CorrectDayDialog";

const WEEKDAY = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "2026-10-05" → "lun 05/10/2026" */
function fmtDay(ymd: string): string {
  const wd = WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
  return `${wd} ${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
}

/** Hora de una entrada/salida; "+1" si cae al día siguiente (turno nocturno). */
function fmtTime(d: Date | null, ymd: string): string {
  if (!d) return "—";
  const t = d.toLocaleTimeString("es-VE", { timeZone: DEFAULT_TZ, hour: "2-digit", minute: "2-digit", hour12: false });
  return dateKeyInTz(d, DEFAULT_TZ) > ymd ? `${t} (+1)` : t;
}

const fmtMin = (m: number | null) => (m == null ? "—" : formatMinutes(m));

const VARIANT: Record<DayStatus, "accent" | "accent2" | "neutral" | "outline"> = {
  present: "accent",
  late: "accent2",
  early_leave: "accent2",
  absent: "accent2",
  incomplete: "neutral",
  rest_day: "outline",
  rest_day_worked: "neutral",
  no_schedule: "outline",
};

/** Estado del día con sus minutos (una tardanza que además salió antes muestra los dos). */
export function DayStatusCell({ r }: { r: AttendanceDayRow }) {
  if (!r.status) return <span className="text-text/60">—</span>;
  const detail = [
    r.lateMinutes != null ? `${r.lateMinutes} min tarde` : null,
    r.earlyLeaveMinutes != null ? `salió ${r.earlyLeaveMinutes} min antes` : null,
    r.status === "incomplete" ? "una sola marcación" : null,
  ].filter(Boolean);
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Tag variant={VARIANT[r.status]}>{DAY_STATUS_LABEL[r.status]}</Tag>
      {detail.length > 0 && <span className="text-xs text-text/70">{detail.join(" · ")}</span>}
    </span>
  );
}

/**
 * Días calculados por el motor (docs/16). `show` elige la columna de identidad:
 * la persona (vista de empresa) o la empresa (ficha del empleado). Cada día se
 * puede corregir (agregar o anular marcaciones, docs/16 paso 4).
 */
export function AttendanceDaysTable({
  rows,
  show,
  personHref,
  canCorrect,
}: {
  rows: AttendanceDayRow[];
  show: "person" | "company";
  personHref?: (r: AttendanceDayRow) => string;
  /** Mostrar "Corregir marcaciones" (Solo lectura no corrige, docs/18). */
  canCorrect: boolean;
}) {
  const who = (r: AttendanceDayRow) =>
    show === "person" ? (
      personHref ? (
        <Link href={personHref(r)} className="text-accent no-underline hover:underline">
          {r.employeeName}
        </Link>
      ) : (
        r.employeeName
      )
    ) : (
      <Link href={`/admin/empresas/${r.companyId}/asistencia?vista=dias`} className="text-accent no-underline hover:underline">
        {r.companyName}
      </Link>
    );
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>{show === "person" ? "Persona" : "Empresa"}</Th>
              <Th>Entrada</Th>
              <Th>Salida</Th>
              <Th>Horas</Th>
              <Th>Extra</Th>
              <Th>Estado</Th>
              {canCorrect && (
                <Th>
                  <span className="sr-only">Corregir</span>
                </Th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Tr key={r.id}>
                <Td className="whitespace-nowrap font-mono text-xs">{fmtDay(r.date)}</Td>
                <Td>{who(r)}</Td>
                <Td className="whitespace-nowrap font-mono">{fmtTime(r.firstIn, r.date)}</Td>
                <Td className="whitespace-nowrap font-mono">{fmtTime(r.lastOut, r.date)}</Td>
                <Td className="whitespace-nowrap">{r.status === "absent" ? "—" : fmtMin(r.workedMinutes)}</Td>
                <Td className="whitespace-nowrap">{r.overtimeMinutes ? fmtMin(r.overtimeMinutes) : "—"}</Td>
                <Td>
                  <DayStatusCell r={r} />
                </Td>
                {canCorrect && (
                  <Td className="w-px">
                    <CorrectDayDialog employmentId={r.employmentId} ymd={r.date} who={`${r.employeeName} · ${r.companyName}`} />
                  </Td>
                )}
              </Tr>
            ))}
          </tbody>
        </Table>
      </div>
      <MobileList>
        {rows.map((r) => (
          <MobileRow
            key={r.id}
            title={show === "person" ? r.employeeName : r.companyName}
            tags={<span className="font-mono text-xs text-text/60">{fmtDay(r.date)}</span>}
            fields={[
              { label: "Entrada / salida", value: `${fmtTime(r.firstIn, r.date)} – ${fmtTime(r.lastOut, r.date)}` },
              { label: "Horas", value: r.status === "absent" ? "—" : fmtMin(r.workedMinutes) },
              { label: "Extra", value: r.overtimeMinutes ? fmtMin(r.overtimeMinutes) : "—" },
              { label: "Estado", value: <DayStatusCell r={r} /> },
            ]}
            actions={
              canCorrect ? <CorrectDayDialog employmentId={r.employmentId} ymd={r.date} who={`${r.employeeName} · ${r.companyName}`} /> : undefined
            }
          />
        ))}
      </MobileList>
    </>
  );
}
