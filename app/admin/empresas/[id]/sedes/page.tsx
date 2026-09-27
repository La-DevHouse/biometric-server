import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { SiteFormDialog } from "@/components/admin/SiteFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import { CompanyTabs } from "@/components/admin/CompanyTabs";
import { setSiteStatusAction } from "@/app/admin/empresas/actions";

export const dynamic = "force-dynamic";

/** Empresa → Sedes (docs/11 C3). Toda empresa activa tiene al menos una sede activa (docs/10 R2). */
export default async function EmpresaSedesPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  if (!Number.isFinite(id)) notFound();

  const company = await prisma.client_company.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      sites: { orderBy: { name: "asc" }, include: { _count: { select: { devices: true } } } },
    },
  });
  if (!company) notFound();

  const statusTag = (active: boolean) => (
    <Tag variant={active ? "accent" : "neutral"}>{active ? "Activa" : "Inactiva"}</Tag>
  );
  const siteActions = (s: (typeof company.sites)[number]) => (
    <>
      <SiteFormDialog companyId={company.id} site={{ id: s.id, name: s.name, code: s.code, timezone: s.timezone }} />
      <RecordStatusButton id={s.id} active={s.status === "active"} label="sede" action={setSiteStatusAction} />
    </>
  );

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <CompanyTabs companyId={company.id} companyName={company.name} active="sedes" actions={<SiteFormDialog companyId={company.id} />} />

      {company.sites.length === 0 ? (
        <EmptyState title="Sin sedes" description="Una empresa activa necesita al menos una sede. Agregá una para asignarle equipos." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Nombre</Th>
                  <Th>Código</Th>
                  <Th>Zona horaria</Th>
                  <Th>Equipos</Th>
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
                    <Td>{statusTag(s.status === "active")}</Td>
                    <Td actions>
                      <span className="inline-flex items-center gap-1">{siteActions(s)}</span>
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
                tags={statusTag(s.status === "active")}
                fields={[
                  { label: "Código", value: s.code ?? "—" },
                  { label: "Zona horaria", value: s.timezone },
                  { label: "Equipos", value: s._count.devices },
                ]}
                actions={siteActions(s)}
              />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}
