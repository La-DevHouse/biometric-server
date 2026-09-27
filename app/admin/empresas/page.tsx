import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr, RowLink } from "@/components/ui/Table";
import { MobileList } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyFormDialog } from "@/components/admin/CompanyFormDialog";
import { GroupFormDialog } from "@/components/admin/GroupFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { CollapsibleGroupRows, CollapsibleGroupCard } from "@/components/admin/CollapsibleGroup";
import { setGroupStatusAction } from "@/app/admin/empresas/actions";

// force-dynamic: Server Component que pega a Postgres — con `revalidate` Next
// intentaría prerenderizarlo en `next build`.
export const dynamic = "force-dynamic";

// Nunca el binario del logo en la lista (hasta 512 KB c/u, docs/11 C2): solo
// si tiene, y la imagen se pide aparte con carga diferida.
async function getCompanies() {
  const [rows, withLogo] = await Promise.all([
    prisma.client_company.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        tax_id: true,
        status: true,
        group_id: true,
        _count: { select: { sites: true, employments: { where: { status: "active" } } } },
      },
    }),
    prisma.$queryRaw<{ id: number }[]>`SELECT id FROM client_company WHERE logo IS NOT NULL`,
  ]);
  const logos = new Set(withLogo.map((r) => r.id));
  return rows.map((r) => ({ ...r, has_logo: logos.has(r.id) }));
}
type CompanyRowData = Awaited<ReturnType<typeof getCompanies>>[number];

async function getGroups() {
  return prisma.company_group.findMany({ orderBy: { name: "asc" } });
}
type GroupData = Awaited<ReturnType<typeof getGroups>>[number];

/** Empresas (docs/11 C1): grupos colapsables como una fila más; las empresas sin grupo, filas normales. */
export default async function EmpresasPage({ searchParams }: { searchParams: Promise<{ grupo?: string }> }) {
  await requireUser();
  const openGroup = Number((await searchParams).grupo) || null;
  const [companies, groups, businessModels] = await Promise.all([
    getCompanies(),
    getGroups(),
    prisma.business_model.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const groupOptions = groups.filter((g) => g.status === "active").map((g) => ({ id: g.id, name: g.name }));
  const inGroup = (id: number) => companies.filter((c) => c.group_id === id);
  const ungrouped = companies.filter((c) => c.group_id === null);

  // Grupos y empresas sueltas mezclados por nombre, como en Adempiere.
  const entries = [
    ...groups.map((g) => ({ kind: "group" as const, name: g.name, g })),
    ...ungrouped.map((c) => ({ kind: "company" as const, name: c.name, c })),
  ].sort((a, b) => a.name.localeCompare(b.name, "es"));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm text-text/75">
          {companies.length} {companies.length === 1 ? "empresa" : "empresas"} · {groups.length}{" "}
          {groups.length === 1 ? "grupo" : "grupos"}
        </p>
        <span className="flex items-center gap-2">
          <GroupFormDialog />
          <CompanyFormDialog groupOptions={groupOptions} businessModels={businessModels} />
        </span>
      </div>

      {companies.length === 0 && groups.length === 0 ? (
        <EmptyState
          title="Todavía no hay empresas"
          description="Creá la primera empresa cliente para empezar. Si varias empresas comparten empleados, creá antes su grupo."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Empresa</Th>
                  <Th>RIF</Th>
                  <Th>Sedes</Th>
                  <Th>Contratos vigentes</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {entries.map((e) =>
                  e.kind === "group" ? (
                    <CollapsibleGroupRows
                      key={`g${e.g.id}${e.g.id === openGroup ? "-open" : ""}`}
                      colSpan={4}
                      defaultOpen={e.g.id === openGroup}
                      name={e.g.name}
                      meta={groupMeta(e.g, inGroup(e.g.id).length)}
                      status={<StatusTag active={e.g.status === "active"} fem={false} />}
                      actions={<GroupActions g={e.g} />}
                    >
                      {inGroup(e.g.id).map((c) => (
                        <CompanyRow key={c.id} c={c} nested />
                      ))}
                    </CollapsibleGroupRows>
                  ) : (
                    <CompanyRow key={e.c.id} c={e.c} />
                  )
                )}
              </tbody>
            </Table>
          </div>
          <MobileList className="gap-1.5">
            {entries.map((e) =>
              e.kind === "group" ? (
                <CollapsibleGroupCard
                  key={`g${e.g.id}${e.g.id === openGroup ? "-open" : ""}`}
                  defaultOpen={e.g.id === openGroup}
                  name={e.g.name}
                  meta={groupMeta(e.g, inGroup(e.g.id).length)}
                  status={e.g.status === "active" ? null : <StatusTag active={false} fem={false} />}
                  actions={<GroupActions g={e.g} />}
                >
                  {inGroup(e.g.id).map((c) => (
                    <CompanyCard key={c.id} c={c} />
                  ))}
                </CollapsibleGroupCard>
              ) : (
                <CompanyCard key={e.c.id} c={e.c} />
              )
            )}
          </MobileList>
        </>
      )}
    </div>
  );
}

function groupMeta(g: GroupData, count: number) {
  return `Grupo · ${count} ${count === 1 ? "empresa" : "empresas"} · ${
    g.shared_employees ? "comparte empleados" : "no comparte empleados"
  }`;
}

function StatusTag({ active, fem }: { active: boolean; fem: boolean }) {
  return (
    <Tag variant={active ? "accent" : "neutral"}>
      {active ? (fem ? "Activa" : "Activo") : fem ? "Inactiva" : "Inactivo"}
    </Tag>
  );
}

function GroupActions({ g }: { g: GroupData }) {
  return (
    <span className="inline-flex items-center gap-1">
      <GroupFormDialog group={{ id: g.id, name: g.name, shared_employees: g.shared_employees }} />
      <RecordStatusButton id={g.id} active={g.status === "active"} label="grupo" action={setGroupStatusAction} />
    </span>
  );
}

/** Logo chico con carga diferida, o la inicial si no tiene (docs/11 C2). */
function Logo({ c, size = "sm" }: { c: CompanyRowData; size?: "sm" | "xs" }) {
  const box = size === "sm" ? "h-7 w-7" : "h-6 w-6";
  if (!c.has_logo) {
    return (
      <span
        aria-hidden
        className={`${box} inline-flex shrink-0 items-center justify-center border border-divider bg-chrome font-heading text-xs font-semibold text-text/60`}
      >
        {c.name.trim().charAt(0).toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/admin/empresas/${c.id}/logo`}
      alt=""
      loading="lazy"
      decoding="async"
      className={`${box} shrink-0 border border-divider bg-surface object-contain p-0.5`}
    />
  );
}

function CompanyRow({ c, nested = false }: { c: CompanyRowData; nested?: boolean }) {
  return (
    <Tr clickable>
      <Td>
        <span className="flex items-center gap-2" style={{ paddingLeft: nested ? 22 : 0 }}>
          <Logo c={c} />
          <RowLink href={`/admin/empresas/${c.id}`} className={nested ? "text-text/85" : "font-medium"}>
            {c.name}
          </RowLink>
        </span>
      </Td>
      <Td className="font-mono text-xs">{c.tax_id ?? <span className="text-text/60">—</span>}</Td>
      <Td>{c._count.sites}</Td>
      <Td>{c._count.employments}</Td>
      <Td>
        <StatusTag active={c.status === "active"} fem />
      </Td>
      <Td />
    </Tr>
  );
}

/** Mobile compacto: una línea por empresa — logo, nombre, RIF y estado solo si está inactiva. */
function CompanyCard({ c }: { c: CompanyRowData }) {
  return (
    <Link
      href={`/admin/empresas/${c.id}`}
      className="flex items-center gap-2.5 border border-divider bg-surface px-3 py-2 text-text no-underline hover:bg-accent-100"
    >
      <Logo c={c} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{c.name}</span>
        <span className="block font-mono text-xs text-text/60">
          {c.tax_id ?? "sin RIF"} · {c._count.employments} contrato(s)
        </span>
      </span>
      {c.status !== "active" && <StatusTag active={false} fem />}
    </Link>
  );
}
