import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { CompanyFormDialog } from "@/components/admin/CompanyFormDialog";

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

export default async function EmpresasPage() {
  await requireUser();
  const companies = await getCompanies();

  const parentOptions = companies
    .filter((c) => c.parent_id === null)
    .map((c) => ({ id: c.id, name: c.name }));
  const roots = companies.filter((c) => c.parent_id === null);
  const childrenOf = (id: number) => companies.filter((c) => c.parent_id === id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="m-0 text-sm text-text/60">
          {companies.length} {companies.length === 1 ? "empresa" : "empresas"}
        </p>
        <CompanyFormDialog parentOptions={parentOptions} />
      </div>

      {companies.length === 0 ? (
        <EmptyState
          title="Todavía no hay empresas"
          description="Creá la primera empresa cliente para empezar."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Empresa</Th>
              <Th>RIF</Th>
              <Th>Tipo</Th>
              <Th>Sedes</Th>
              <Th>Empleos</Th>
              <Th>Estado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {roots.flatMap((root) => [
              <CompanyRow key={root.id} c={root} depth={0} />,
              ...childrenOf(root.id).map((child) => (
                <CompanyRow key={child.id} c={child} depth={1} />
              )),
            ])}
          </tbody>
        </Table>
      )}
    </div>
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
        {c.tax_id ?? <span className="text-text/40">—</span>}
      </Td>
      <Td>{c.is_group ? <Tag variant="neutral">Grupo</Tag> : "Operativa"}</Td>
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
