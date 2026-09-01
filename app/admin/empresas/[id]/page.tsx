import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyFormDialog, type CompanyFormValues } from "@/components/admin/CompanyFormDialog";
import { SiteFormDialog } from "@/components/admin/SiteFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { setCompanyStatusAction, setSiteStatusAction } from "@/app/admin/empresas/actions";

export const dynamic = "force-dynamic";

export default async function EmpresaDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const company = await prisma.client_company.findUnique({
    where: { id },
    include: {
      parent: { select: { id: true, name: true } },
      children: { select: { id: true, name: true, status: true }, orderBy: { name: "asc" } },
      sites: { orderBy: { name: "asc" } },
      _count: { select: { employments: true, devices: true } },
    },
  });
  if (!company) notFound();

  const parentOptions = (
    await prisma.client_company.findMany({
      where: { parent_id: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    })
  ).filter((p) => p.id !== id);

  const formValues: CompanyFormValues = {
    id: company.id,
    name: company.name,
    tax_id: company.tax_id,
    is_group: company.is_group,
    shared_employees: company.shared_employees,
    address: company.address,
    parent_id: company.parent_id,
    late_tolerance_min: company.late_tolerance_min,
    early_leave_tolerance_min: company.early_leave_tolerance_min,
    absence_rule: company.absence_rule,
    absence_min_hours: company.absence_min_hours,
  };

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin/empresas" className="text-xs text-accent no-underline hover:underline">
          ← Empresas
        </Link>
        <div className="mt-1 flex items-center gap-3">
          <h2 className="m-0 text-2xl">{company.name}</h2>
          <Tag variant={company.status === "active" ? "accent" : "neutral"}>
            {company.status === "active" ? "Activa" : "Inactiva"}
          </Tag>
          {company.is_group && <Tag variant="neutral">Grupo</Tag>}
        </div>
      </div>

      <section className="flex flex-col gap-2 border border-divider p-4 text-sm">
        <Row label="RIF" value={company.tax_id ?? "—"} mono />
        <Row
          label="Padre"
          value={
            company.parent ? (
              <Link href={`/admin/empresas/${company.parent.id}`} className="text-accent no-underline hover:underline">
                {company.parent.name}
              </Link>
            ) : (
              "— nivel superior —"
            )
          }
        />
        <Row label="Empleados compartidos" value={company.shared_employees ? "Sí" : "No"} />
        <Row label="Dirección" value={company.address ?? "—"} />
        <Row label="Empleos" value={String(company._count.employments)} />
        <Row label="Dispositivos" value={String(company._count.devices)} />
        <Row
          label="Umbrales asistencia"
          value={
            company.late_tolerance_min == null &&
            company.early_leave_tolerance_min == null &&
            company.absence_rule == null
              ? "sin definir"
              : `tardanza ${company.late_tolerance_min ?? "–"} min · salida antic. ${
                  company.early_leave_tolerance_min ?? "–"
                } min · ausencia: ${company.absence_rule ?? "–"}`
          }
        />
        <div className="mt-1 flex gap-2">
          <CompanyFormDialog company={formValues} parentOptions={parentOptions} trigger="ghost" />
          <RecordStatusButton
            id={company.id}
            active={company.status === "active"}
            label="empresa"
            action={setCompanyStatusAction}
          />
        </div>
      </section>

      {company.children.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/60">
            Empresas hijas
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {company.children.map((ch) => (
              <li key={ch.id}>
                <Link href={`/admin/empresas/${ch.id}`} className="text-accent no-underline hover:underline">
                  {ch.name}
                </Link>{" "}
                {ch.status !== "active" && <span className="text-text/40">(inactiva)</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">Sedes</h3>
          <SiteFormDialog companyId={company.id} />
        </div>
        {company.sites.length === 0 ? (
          <EmptyState title="Sin sedes" description="Agregá al menos una sede para asignarle dispositivos y empleos." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Código</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {company.sites.map((s) => (
                <Tr key={s.id}>
                  <Td>{s.name}</Td>
                  <Td className="font-mono text-xs">{s.code ?? <span className="text-text/40">—</span>}</Td>
                  <Td>
                    <Tag variant={s.status === "active" ? "accent" : "neutral"}>
                      {s.status === "active" ? "Activa" : "Inactiva"}
                    </Tag>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1">
                      <SiteFormDialog
                        companyId={company.id}
                        site={{ id: s.id, name: s.name, code: s.code }}
                      />
                      <RecordStatusButton
                        id={s.id}
                        active={s.status === "active"}
                        label="sede"
                        action={setSiteStatusAction}
                      />
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <span className="w-44 flex-none text-text/50">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
