import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyFormDialog, type CompanyFormValues } from "@/components/admin/CompanyFormDialog";
import { SiteFormDialog } from "@/components/admin/SiteFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { ResyncEnrollmentsButton } from "@/components/admin/ResyncEnrollmentsButton";
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
      group: {
        select: {
          id: true,
          name: true,
          status: true,
          shared_employees: true,
          companies: { select: { id: true, name: true, status: true }, orderBy: { name: "asc" } },
        },
      },
      business_model: { select: { name: true } },
      sites: { orderBy: { name: "asc" }, include: { _count: { select: { devices: true } } } },
      _count: { select: { employments: true } },
    },
  });
  if (!company) notFound();
  const deviceCount = company.sites.reduce((n, s) => n + s._count.devices, 0);
  const siblings = company.group?.companies.filter((c) => c.id !== company.id) ?? [];

  const [groupRows, businessModels] = await Promise.all([
    prisma.company_group.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.business_model.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  // el grupo actual se ofrece aunque esté inactivo, para no perderlo al editar
  const groupOptions =
    company.group && !groupRows.some((g) => g.id === company.group!.id)
      ? [...groupRows, { id: company.group.id, name: `${company.group.name} (inactivo)` }]
      : groupRows;

  const formValues: CompanyFormValues = {
    id: company.id,
    name: company.name,
    tax_id: company.tax_id,
    address: company.address,
    group_id: company.group_id,
    business_model_id: company.business_model_id,
    has_logo: company.logo != null,
    legal_rep_name: company.legal_rep_name,
    legal_rep_national_id: company.legal_rep_national_id,
    legal_rep_phone: company.legal_rep_phone,
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
          <h2 className="font-heading text-2xl font-semibold tracking-tight m-0">{company.name}</h2>
          <Tag variant={company.status === "active" ? "accent" : "neutral"}>
            {company.status === "active" ? "Activa" : "Inactiva"}
          </Tag>
        </div>
      </div>

      <section className="flex flex-col gap-2 border border-divider p-4 text-sm">
        <Row label="RIF" value={company.tax_id ?? "—"} mono />
        <Row
          label="Grupo"
          value={
            company.group
              ? `${company.group.name}${company.group.status !== "active" ? " (inactivo)" : ""} · ${
                  company.group.shared_employees ? "comparte empleados" : "no comparte empleados"
                }`
              : "— sin grupo —"
          }
        />
        <Row label="Modelo de negocio" value={company.business_model?.name ?? "— sin especificar —"} />
        <Row label="Dirección" value={company.address ?? "—"} />
        <Row
          label="Representante legal"
          value={
            company.legal_rep_name
              ? `${company.legal_rep_name}${company.legal_rep_national_id ? ` · ${company.legal_rep_national_id}` : ""}${company.legal_rep_phone ? ` · ${company.legal_rep_phone}` : ""}`
              : "—"
          }
        />
        <Row
          label="Logo"
          value={
            company.logo != null ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/admin/empresas/${company.id}/logo`}
                alt="logo"
                className="h-10 w-auto border border-divider bg-surface object-contain p-0.5"
              />
            ) : (
              "—"
            )
          }
        />
        <Row label="Contratos" value={String(company._count.employments)} />
        <Row label="Dispositivos" value={String(deviceCount)} />
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
          <CompanyFormDialog company={formValues} groupOptions={groupOptions} businessModels={businessModels} />
          <RecordStatusButton
            id={company.id}
            active={company.status === "active"}
            label="empresa"
            action={setCompanyStatusAction}
          />
          <ResyncEnrollmentsButton companyId={company.id} />
        </div>
      </section>

      {siblings.length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/60">
            Otras empresas del grupo
          </h3>
          <ul className="flex flex-col gap-1 text-sm">
            {siblings.map((ch) => (
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
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">Sedes</h3>
          <SiteFormDialog companyId={company.id} />
        </div>
        {company.sites.length === 0 ? (
          <EmptyState title="Sin sedes" description="Una empresa activa necesita al menos una sede. Agregá una para asignarle dispositivos." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Nombre</Th>
                    <Th>Código</Th>
                    <Th>Zona horaria</Th>
                    <Th>Dispositivos</Th>
                    <Th>Estado</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {company.sites.map((s) => (
                    <Tr key={s.id}>
                      <Td>{s.name}</Td>
                      <Td className="font-mono text-xs">{s.code ?? <span className="text-text/60">—</span>}</Td>
                      <Td className="text-xs">{s.timezone}</Td>
                      <Td>{s._count.devices}</Td>
                      <Td>
                        <Tag variant={s.status === "active" ? "accent" : "neutral"}>
                          {s.status === "active" ? "Activa" : "Inactiva"}
                        </Tag>
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1">
                          <SiteFormDialog
                            companyId={company.id}
                            site={{ id: s.id, name: s.name, code: s.code, timezone: s.timezone }}
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
            </div>
            <MobileList>
              {company.sites.map((s) => (
                <MobileRow
                  key={s.id}
                  title={s.name}
                  tags={
                    <Tag variant={s.status === "active" ? "accent" : "neutral"}>
                      {s.status === "active" ? "Activa" : "Inactiva"}
                    </Tag>
                  }
                  fields={[
                    { label: "Código", value: s.code ?? "—" },
                    { label: "Zona horaria", value: s.timezone },
                    { label: "Dispositivos", value: s._count.devices },
                  ]}
                  actions={
                    <>
                      <SiteFormDialog
                        companyId={company.id}
                        site={{ id: s.id, name: s.name, code: s.code, timezone: s.timezone }}
                      />
                      <RecordStatusButton
                        id={s.id}
                        active={s.status === "active"}
                        label="sede"
                        action={setSiteStatusAction}
                      />
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
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <span className="sm:w-44 sm:flex-none text-text/70">{label}</span>
      <span className={mono ? "font-mono" : undefined}>{value}</span>
    </div>
  );
}
