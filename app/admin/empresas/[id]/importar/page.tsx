import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { CompanyImportPanel } from "@/components/admin/CompanyImportPanel";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { formatDateTime } from "@/lib/formatRelativeTime";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; variant: "accent" | "accent2" | "neutral" | "outline" }> = {
  applied: { label: "Aplicada", variant: "accent" },
  preview: { label: "Sin confirmar", variant: "outline" },
  failed: { label: "Falló", variant: "accent2" },
  expired: { label: "Vencida", variant: "outline" },
};

interface Summary {
  rejected?: number;
  result?: { employeesCreated: number; contractsCreated: number; contractsUpdated: number };
}

/** Empresa > Empleados > Importar desde Galepso (docs/14). */
export default async function EmpresaImportarPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();
  const company = await prisma.client_company.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!company) notFound();
  const runParam = Number((await searchParams).run);
  const resumeRunId = Number.isInteger(runParam) && runParam > 0 ? runParam : undefined;
  const runs = await prisma.import_run.findMany({
    where: { company_id: id },
    orderBy: { created_at: "desc" },
    take: 10,
    select: { id: true, file_name: true, status: true, created_at: true, summary: true, actor: { select: { name: true } } },
  });

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <CompanyTabs companyId={company.id} companyName={company.name} active="empleados" />

      <section className="flex flex-col gap-2">
        <h2 className="m-0 font-heading text-xl font-semibold">Importar trabajadores desde Galepso</h2>
        <p className="m-0 text-sm text-text/80">
          Subí el <b>Roster de Personal</b> de esta empresa impreso a PDF desde Galepso (status ACTIVO). A cada persona se le crea
          su ficha si no existe, con su fecha de nacimiento si el reporte la trae, y un contrato en {company.name} con la fecha
          de ingreso como inicio. Antes de aplicar vas a ver qué se crea, y podés corregir el corte de nombres y a qué puesto va
          cada cargo. Si hay una sola fila con error, no se aplica nada.
        </p>
      </section>

      <CompanyImportPanel key={resumeRunId ?? "new"} companyId={company.id} resumeRunId={resumeRunId} />

      {runs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="m-0 font-mono text-label uppercase tracking-[0.12em] text-neutral-800">Importaciones de esta empresa</h3>
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Archivo</Th>
                <Th>Por</Th>
                <Th>Estado</Th>
                <Th>Resultado</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const s = (r.summary ?? {}) as Summary;
                const st = STATUS[r.status] ?? { label: r.status, variant: "neutral" as const };
                const res = s.result
                  ? `${s.result.employeesCreated} persona(s) nueva(s) · ${s.result.contractsCreated} contrato(s)${s.result.contractsUpdated ? ` · ${s.result.contractsUpdated} con puesto actualizado` : ""}`
                  : s.rejected
                    ? `${s.rejected} problema(s)`
                    : "—";
                return (
                  <Tr key={r.id}>
                    <Td className="whitespace-nowrap">{formatDateTime(r.created_at.getTime())}</Td>
                    <Td className="[overflow-wrap:anywhere]">{r.file_name}</Td>
                    <Td>{r.actor?.name ?? "—"}</Td>
                    <Td>
                      <span className="flex flex-wrap items-center gap-2">
                        <Tag variant={st.variant}>{st.label}</Tag>
                        {r.status === "preview" && (
                          <Link href={`/admin/empresas/${company.id}/importar?run=${r.id}`} className="text-sm font-semibold text-accent-700 underline">
                            Continuar
                          </Link>
                        )}
                      </span>
                    </Td>
                    <Td>{res}</Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </section>
      )}
    </div>
  );
}
