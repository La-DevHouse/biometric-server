import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupFormDialog, type GroupValues } from "@/components/admin/GroupFormDialog";
import { ShiftFormDialog, type ShiftValues } from "@/components/admin/ShiftFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { DeleteButton } from "@/components/admin/DeleteButton";
import { setGroupStatusAction, deleteShiftAction } from "@/app/admin/grupos/actions";

export const dynamic = "force-dynamic";

const DAY_LABELS = ["", "L", "M", "M", "J", "V", "S", "D"];
function fmtWorkdays(days: number[]): string {
  if (!days.length) return "—";
  return [...days].sort((a, b) => a - b).map((d) => DAY_LABELS[d] ?? "?").join(" ");
}
function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function GrupoDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const group = await prisma.employee_group.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, late_tolerance_min: true, early_leave_tolerance_min: true, absence_rule: true } },
      shifts: { orderBy: [{ effective_from: "desc" }] },
      _count: { select: { employments: true } },
    },
  });
  if (!group) notFound();

  const companies = await prisma.client_company.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const groupForm: GroupValues = {
    id: group.id,
    company_id: group.company_id,
    name: group.name,
    code: group.code,
    late_tolerance_min: group.late_tolerance_min,
    early_leave_tolerance_min: group.early_leave_tolerance_min,
    absence_rule: group.absence_rule,
    absence_min_hours: group.absence_min_hours,
  };

  const eff = (v: number | null, fb: number | null) =>
    v != null ? `${v}` : fb != null ? `${fb} (empresa)` : "—";

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href="/admin/grupos" className="text-xs text-accent no-underline hover:underline">
          ← Grupos y turnos
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h2 className="m-0 text-2xl">{group.name}</h2>
          <Tag variant={group.status === "active" ? "accent" : "neutral"}>
            {group.status === "active" ? "Activo" : "Inactivo"}
          </Tag>
        </div>
        <p className="m-0 mt-1 text-sm text-text/60">
          Empresa:{" "}
          <Link href={`/admin/empresas/${group.company.id}`} className="text-accent no-underline hover:underline">
            {group.company.name}
          </Link>
        </p>
      </div>

      <section className="flex flex-col gap-2 border border-divider p-4 text-sm">
        <div className="flex gap-3">
          <span className="w-56 flex-none text-text/50">Empleos en el grupo</span>
          <span>{group._count.employments}</span>
        </div>
        <div className="flex gap-3">
          <span className="w-56 flex-none text-text/50">Tolerancia tardanza</span>
          <span>{eff(group.late_tolerance_min, group.company.late_tolerance_min)} min</span>
        </div>
        <div className="flex gap-3">
          <span className="w-56 flex-none text-text/50">Tolerancia salida anticipada</span>
          <span>{eff(group.early_leave_tolerance_min, group.company.early_leave_tolerance_min)} min</span>
        </div>
        <div className="flex gap-3">
          <span className="w-56 flex-none text-text/50">Regla de ausencia</span>
          <span>{group.absence_rule ?? group.company.absence_rule ?? "—"}</span>
        </div>
        <div className="mt-1 flex gap-2">
          <GroupFormDialog group={groupForm} companies={companies} />
          <RecordStatusButton id={group.id} active={group.status === "active"} label="grupo" action={setGroupStatusAction} />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">Turnos</h3>
          <ShiftFormDialog groupId={group.id} />
        </div>
        {group.shifts.length === 0 ? (
          <EmptyState title="Sin turnos" description="Agregá al menos un turno con su horario y días de trabajo." />
        ) : (
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
              {group.shifts.map((s) => {
                const shiftForm: ShiftValues = {
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
                return (
                  <Tr key={s.id}>
                    <Td>
                      {s.name}
                      {s.code && <span className="ml-1 font-mono text-xs text-text/40">{s.code}</span>}
                      {s.crosses_midnight && (
                        <Tag variant="neutral" className="ml-2">
                          +1 día
                        </Tag>
                      )}
                    </Td>
                    <Td className="font-mono text-xs">
                      {s.start_time}–{s.end_time}
                      {s.variable_in_out && <span className="text-text/40"> (var.)</span>}
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
                        <ShiftFormDialog groupId={group.id} shift={shiftForm} />
                        <DeleteButton id={s.id} label="turno" action={deleteShiftAction} />
                      </span>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
