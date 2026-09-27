import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { activeEmploymentWhere } from "@/lib/scope";
import { EmployeeTabs } from "@/components/admin/EmployeeTabs";

export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

/** Empleado → Información (docs/11 P1): documento, RIF, nacimiento, foto de cédula. */
export default async function EmpleadoInfoPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const [employee, withPhoto, vigentes] = await Promise.all([
    prisma.employee.findUnique({
      where: { id },
      select: {
        id: true,
        national_id: true,
        tax_id: true,
        birth_date: true,
        _count: { select: { fingerprints: { where: { status: "active" } } } },
      },
    }),
    prisma.$queryRaw<{ id: number }[]>`SELECT id FROM employee WHERE id = ${id} AND cedula_photo IS NOT NULL`,
    prisma.employment.findMany({
      where: { employee_id: id, ...activeEmploymentWhere() },
      select: { company: { select: { id: true, name: true } } },
    }),
  ]);
  if (!employee) notFound();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <EmployeeTabs employeeId={employee.id} active="info" />

      <section className="flex flex-col gap-2 border border-divider p-4 text-sm">
        <Field label="Documento" value={employee.national_id} mono />
        <Field label="RIF" value={employee.tax_id ?? "—"} mono />
        <Field label="Fecha de nacimiento" value={fmtDate(employee.birth_date)} />
        <Field
          label="Contrato vigente con"
          value={
            vigentes.length === 0 ? (
              <span className="text-text/60">nadie (pool de reclutamiento)</span>
            ) : (
              vigentes.map((v, i) => (
                <span key={v.company.id}>
                  {i > 0 && ", "}
                  <Link href={`/admin/empresas/${v.company.id}`} className="text-accent no-underline hover:underline">
                    {v.company.name}
                  </Link>
                </span>
              ))
            )
          }
        />
        <Field label="Huellas" value={String(employee._count.fingerprints)} />
        <Field
          label="Cédula (foto)"
          value={
            withPhoto.length > 0 ? (
              <a href={`/admin/empleados/${employee.id}/cedula`} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/admin/empleados/${employee.id}/cedula`}
                  alt="cédula escaneada"
                  className="h-32 w-auto border border-divider bg-surface object-contain p-0.5"
                />
              </a>
            ) : (
              "—"
            )
          }
        />
      </section>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="text-text/70 sm:w-48 sm:flex-none">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
