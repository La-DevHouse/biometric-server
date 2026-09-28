import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Tag } from "@/components/ui/Tag";
import { CompanyFormDialog, type CompanyFormValues } from "@/components/admin/CompanyFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { ResyncEnrollmentsButton } from "@/components/admin/ResyncEnrollmentsButton";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { setCompanyStatusAction } from "@/app/admin/empresas/actions";

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
    has_legal_rep_photo: company.legal_rep_cedula_photo != null,
    late_tolerance_min: company.late_tolerance_min,
    early_leave_tolerance_min: company.early_leave_tolerance_min,
    absence_rule: company.absence_rule,
    absence_min_hours: company.absence_min_hours,
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <CompanyTabs
        companyId={company.id}
        companyName={company.name}
        active="datos"
        badges={
          <Tag variant={company.status === "active" ? "accent" : "neutral"}>
            {company.status === "active" ? "Activa" : "Inactiva"}
          </Tag>
        }
        actions={
          <>
            <CompanyFormDialog company={formValues} groupOptions={groupOptions} businessModels={businessModels} />
            <ResyncEnrollmentsButton companyId={company.id} />
            <RecordStatusButton id={company.id} active={company.status === "active"} label="empresa" action={setCompanyStatusAction} />
          </>
        }
      />

      <section className="flex flex-col-reverse gap-4 border border-divider p-4 text-sm sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
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
              company.legal_rep_name || company.legal_rep_cedula_photo ? (
                <span className="flex flex-wrap items-center gap-3">
                  <span>
                    {[company.legal_rep_name, company.legal_rep_national_id, company.legal_rep_phone].filter(Boolean).join(" · ") || "—"}
                  </span>
                  {company.legal_rep_cedula_photo && (
                    <a href={`/admin/empresas/${company.id}/representante`} target="_blank" rel="noreferrer" title="Ver cédula">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/admin/empresas/${company.id}/representante`}
                        alt="cédula del representante"
                        className="h-10 w-auto border border-divider bg-surface object-contain p-0.5"
                      />
                    </a>
                  )}
                </span>
              ) : (
                "—"
              )
            }
          />
          <Row label="Sedes" value={String(company.sites.length)} />
          <Row label="Contratos" value={String(company._count.employments)} />
          <Row label="Equipos" value={String(deviceCount)} />
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
        </div>
        {company.logo != null && (
          // Logo grande arriba a la derecha (docs/11 C3).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/admin/empresas/${company.id}/logo`}
            alt={`Logo de ${company.name}`}
            className="h-24 w-auto max-w-[12rem] self-start border border-divider bg-surface object-contain p-1 sm:h-28"
          />
        )}
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
