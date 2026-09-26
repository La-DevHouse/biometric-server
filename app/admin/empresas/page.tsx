import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyFormDialog } from "@/components/admin/CompanyFormDialog";
import { GroupFormDialog } from "@/components/admin/GroupFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { setGroupStatusAction } from "@/app/admin/empresas/actions";

// force-dynamic: Server Component que pega a Postgres — con `revalidate` Next
// intentaría prerenderizarlo en `next build`.
export const dynamic = "force-dynamic";

async function getCompanies() {
  return prisma.client_company.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { sites: true, employments: true } } },
  });
}
type CompanyRowData = Awaited<ReturnType<typeof getCompanies>>[number];

async function getGroups() {
  return prisma.company_group.findMany({ orderBy: { name: "asc" } });
}
type GroupData = Awaited<ReturnType<typeof getGroups>>[number];

export default async function EmpresasPage() {
  await requireUser();
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
                  <Th>Contratos</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((g) => [
                  <GroupRow key={`g${g.id}`} g={g} count={inGroup(g.id).length} />,
                  ...inGroup(g.id).map((c) => <CompanyRow key={c.id} c={c} depth={1} />),
                ])}
                {groups.length > 0 && ungrouped.length > 0 && (
                  <tr>
                    <td colSpan={6} className="p-2 pt-4 text-xs font-semibold uppercase tracking-wide text-text/60">
                      Sin grupo
                    </td>
                  </tr>
                )}
                {ungrouped.map((c) => (
                  <CompanyRow key={c.id} c={c} depth={0} />
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {groups.flatMap((g) => [
              <GroupMobileRow key={`g${g.id}`} g={g} count={inGroup(g.id).length} />,
              ...inGroup(g.id).map((c) => <CompanyMobileRow key={c.id} c={c} depth={1} />),
            ])}
            {ungrouped.map((c) => (
              <CompanyMobileRow key={c.id} c={c} depth={0} />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}

function sharedLabel(g: GroupData) {
  return g.shared_employees ? "Comparte empleados" : "No comparte empleados";
}

function GroupActions({ g }: { g: GroupData }) {
  return (
    <span className="inline-flex items-center gap-1">
      <GroupFormDialog group={{ id: g.id, name: g.name, shared_employees: g.shared_employees }} />
      <RecordStatusButton id={g.id} active={g.status === "active"} label="grupo" action={setGroupStatusAction} />
    </span>
  );
}

function GroupRow({ g, count }: { g: GroupData; count: number }) {
  return (
    <tr className="bg-chrome">
      <td className="p-2 border-b border-neutral-200" colSpan={4}>
        <span className="font-heading font-semibold">{g.name}</span>{" "}
        <Tag variant="neutral">Grupo</Tag>{" "}
        <span className="text-xs text-text/70">
          {sharedLabel(g)} · {count} {count === 1 ? "empresa" : "empresas"}
        </span>
      </td>
      <td className="p-2 border-b border-neutral-200">
        <Tag variant={g.status === "active" ? "accent" : "neutral"}>
          {g.status === "active" ? "Activo" : "Inactivo"}
        </Tag>
      </td>
      <td className="p-2 border-b border-neutral-200">
        <GroupActions g={g} />
      </td>
    </tr>
  );
}

function GroupMobileRow({ g, count }: { g: GroupData; count: number }) {
  return (
    <MobileRow
      title={g.name}
      tags={
        <>
          <Tag variant="neutral">Grupo</Tag>
          <Tag variant={g.status === "active" ? "accent" : "neutral"}>
            {g.status === "active" ? "Activo" : "Inactivo"}
          </Tag>
        </>
      }
      fields={[
        { label: "Empleados", value: sharedLabel(g) },
        { label: "Empresas", value: count },
      ]}
      actions={<GroupActions g={g} />}
    />
  );
}

function CompanyMobileRow({ c, depth }: { c: CompanyRowData; depth: number }) {
  return (
    <MobileRow
      href={`/admin/empresas/${c.id}`}
      title={
        <>
          {depth > 0 ? "↳ " : ""}
          {c.name}
        </>
      }
      tags={
        <>
          <Tag variant={c.status === "active" ? "accent" : "neutral"}>
            {c.status === "active" ? "Activa" : "Inactiva"}
          </Tag>
        </>
      }
      fields={[
        { label: "RIF", value: c.tax_id ?? "—" },
        { label: "Sedes", value: c._count.sites },
        { label: "Contratos", value: c._count.employments },
      ]}
    />
  );
}

function CompanyRow({ c, depth }: { c: CompanyRowData; depth: number }) {
  return (
    <Tr>
      <Td>
        <span
          className={depth > 0 ? "text-text/80" : "font-medium"}
          style={{ paddingLeft: depth * 18 }}
        >
          {depth > 0 ? "↳ " : ""}
          {c.name}
        </span>
      </Td>
      <Td className="font-mono text-xs">
        {c.tax_id ?? <span className="text-text/60">—</span>}
      </Td>
      <Td>{c._count.sites}</Td>
      <Td>{c._count.employments}</Td>
      <Td>
        <Tag variant={c.status === "active" ? "accent" : "neutral"}>
          {c.status === "active" ? "Activa" : "Inactiva"}
        </Tag>
      </Td>
      <Td>
        <LinkBtn href={`/admin/empresas/${c.id}`} variant="ghost">
          Detalle →
        </LinkBtn>
      </Td>
    </Tr>
  );
}
