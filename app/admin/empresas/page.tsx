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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="m-0 text-sm text-text/75">
          {companies.length} {companies.length === 1 ? "empresa" : "empresas"}
        </p>
        <CompanyFormDialog />
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
              <Th>Sedes</Th>
              <Th>Empleos</Th>
              <Th>Estado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {companies.map((c) => (
              <CompanyRow key={c.id} c={c} />
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function CompanyRow({ c }: { c: CompanyRowData }) {
  return (
    <Tr>
      <Td className="font-medium">{c.name}</Td>
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
