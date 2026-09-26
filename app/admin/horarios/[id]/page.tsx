import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { ScheduleFormDialog, type ScheduleValues } from "@/components/admin/ScheduleFormDialog";
import { ShiftFormDialog, type ShiftValues } from "@/components/admin/ShiftFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { setScheduleStatusAction, deleteShiftAction } from "@/app/admin/horarios/actions";

export const dynamic = "force-dynamic";

const DAY_LABELS = ["", "L", "M", "M", "J", "V", "S", "D"];
function fmtWorkdays(days: number[]): string {
  if (!days.length) return "—";
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d] ?? "?").join(" ");
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function ScheduleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const schedule = await prisma.schedule_group.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, late_tolerance_min: true, early_leave_tolerance_min: true, absence_rule: true } },
      shifts: { orderBy: [{ effective_from: "desc" }] },
      _count: { select: { employments: true } },
    },
  });
  if (!schedule) notFound();

  const companies = await prisma.client_company.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const scheduleForm: ScheduleValues = {
    id: schedule.id,
    company_id: schedule.company_id,
    name: schedule.name,
    code: schedule.code,
    late_tolerance_min: schedule.late_tolerance_min,
    early_leave_tolerance_min: schedule.early_leave_tolerance_min,
    absence_rule: schedule.absence_rule,
    absence_min_hours: schedule.absence_min_hours,
  };

  const eff = (v: number | null, fb: number | null) =>
    v != null ? `${v}` : fb != null ? `${fb} (empresa)` : "—";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/admin/horarios" className="text-xs text-accent no-underline hover:underline">
          ← Horarios y turnos
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h2 className="font-heading text-2xl font-semibold tracking-tight m-0">{schedule.name}</h2>
          <Tag variant={schedule.status === "active" ? "accent" : "neutral"}>
            {schedule.status === "active" ? "Activo" : "Inactivo"}
          </Tag>
        </div>
        <p className="m-0 mt-1 text-sm text-text/75">
          Empresa:{" "}
          <Link href={`/admin/empresas/${schedule.company.id}`} className="text-accent no-underline hover:underline">
            {schedule.company.name}
          </Link>
        </p>
      </div>

      <section className="flex flex-col gap-2 border border-divider p-4 text-sm">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <span className="sm:w-56 sm:flex-none text-text/70">Empleos en el horario</span>
          <span>{schedule._count.employments}</span>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <span className="sm:w-56 sm:flex-none text-text/70">Tolerancia tardanza</span>
          <span>{eff(schedule.late_tolerance_min, schedule.company.late_tolerance_min)} min</span>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <span className="sm:w-56 sm:flex-none text-text/70">Tolerancia salida anticipada</span>
          <span>{eff(schedule.early_leave_tolerance_min, schedule.company.early_leave_tolerance_min)} min</span>
        </div>
        <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
          <span className="sm:w-56 sm:flex-none text-text/70">Regla de ausencia</span>
          <span>{schedule.absence_rule ?? schedule.company.absence_rule ?? "—"}</span>
        </div>
        <div className="mt-1 flex gap-2">
          <ScheduleFormDialog schedule={scheduleForm} companies={companies} />
          <RecordStatusButton id={schedule.id} active={schedule.status === "active"} label="horario" action={setScheduleStatusAction} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">Turnos</h3>
          <ShiftFormDialog scheduleGroupId={schedule.id} />
        </div>
        {schedule.shifts.length === 0 ? (
          <EmptyState title="Sin turnos" description="Agregá al menos un turno con su horario y días de trabajo." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Nombre</Th>
                    <Th>Horario</Th>
                    <Th>Descanso</Th>
                    <Th>Días</Th>
                    <Th>Vigencia</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {schedule.shifts.map((s) => {
                    const shiftForm: ShiftValues = shiftFormValues(s);
                    return (
                      <Tr key={s.id}>
                        <Td>
                          {s.name}
                          {s.code && <span className="ml-1 font-mono text-xs text-text/60">{s.code}</span>}
                          {s.crosses_midnight && (
                            <Tag variant="neutral" className="ml-2">
                              +1 día
                            </Tag>
                          )}
                        </Td>
                        <Td className="font-mono text-xs">
                          {s.start_time}–{s.end_time}
                          {s.variable_in_out && <span className="text-text/60"> (var.)</span>}
                        </Td>
                        <Td className="font-mono text-xs">
                          {s.break_start && s.break_end ? `${s.break_start}–${s.break_end}` : "—"}
                        </Td>
                        <Td className="font-mono text-xs">{fmtWorkdays(s.workdays)}</Td>
                        <Td className="text-xs">
                          {fmtDate(s.effective_from)}
                          {" → "}
                          {s.effective_to ? fmtDate(s.effective_to) : "∞"}
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1">
                            <ShiftFormDialog scheduleGroupId={schedule.id} shift={shiftForm} />
                            <DeleteButton id={s.id} label="turno" action={deleteShiftAction} />
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </Table>
            </div>
            <MobileList>
              {schedule.shifts.map((s) => (
                <MobileRow
                  key={s.id}
                  title={s.name}
                  tags={s.crosses_midnight && <Tag variant="neutral">+1 día</Tag>}
                  fields={[
                    {
                      label: "Horario",
                      value: `${s.start_time}–${s.end_time}${s.variable_in_out ? " (var.)" : ""}`,
                    },
                    {
                      label: "Descanso",
                      value: s.break_start && s.break_end ? `${s.break_start}–${s.break_end}` : "—",
                    },
                    { label: "Días", value: fmtWorkdays(s.workdays) },
                    {
                      label: "Vigencia",
                      value: `${fmtDate(s.effective_from)} → ${s.effective_to ? fmtDate(s.effective_to) : "∞"}`,
                    },
                  ]}
                  actions={
                    <>
                      <ShiftFormDialog scheduleGroupId={schedule.id} shift={shiftFormValues(s)} />
                      <DeleteButton id={s.id} label="turno" action={deleteShiftAction} />
                    </>
                  }
                />
              ))}
            </MobileList>
          </>
        )}
      </section>
    </div>
  );
}

function shiftFormValues(s: {
  id: number;
  code: string | null;
  name: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  hours: unknown;
  variable_in_out: boolean;
  crosses_midnight: boolean;
  workdays: number[];
  effective_from: Date;
  effective_to: Date | null;
}): ShiftValues {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    start_time: s.start_time,
    end_time: s.end_time,
    break_start: s.break_start,
    break_end: s.break_end,
    hours: s.hours != null ? String(s.hours) : null,
    variable_in_out: s.variable_in_out,
    crosses_midnight: s.crosses_midnight,
    workdays: s.workdays,
    effective_from: fmtDate(s.effective_from),
    effective_to: s.effective_to ? fmtDate(s.effective_to) : null,
  };
}
