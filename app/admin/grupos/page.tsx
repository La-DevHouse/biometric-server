import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { GroupFormDialog } from "@/components/admin/GroupFormDialog";

export const dynamic = "force-dynamic";

export default async function GruposPage() {
  await requireUser();
  const [groups, companies] = await Promise.all([
    prisma.employee_group.findMany({
      orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
      include: {
        company: { select: { name: true } },
        _count: { select: { shifts: true, employments: true } },
      },
    }),
    prisma.client_company.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="m-0 text-sm text-text/75">
          {groups.length} {groups.length === 1 ? "grupo" : "grupos"}
        </p>
        <GroupFormDialog companies={companies} />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Todavía no hay grupos"
          description="Un grupo de empleados define el horario común (turnos) de un conjunto de gente en una empresa."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Grupo</Th>
                  <Th>Empresa</Th>
                  <Th>Código</Th>
                  <Th>Turnos</Th>
                  <Th>Empleos</Th>
                  <Th>Estado</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Tr key={g.id}>
                    <Td className="font-medium">{g.name}</Td>
                    <Td>{g.company.name}</Td>
                    <Td className="font-mono text-xs">{g.code ?? <span className="text-text/60">—</span>}</Td>
                    <Td>{g._count.shifts}</Td>
                    <Td>{g._count.employments}</Td>
                    <Td>
                      <Tag variant={g.status === "active" ? "accent" : "neutral"}>
                        {g.status === "active" ? "Activo" : "Inactivo"}
                      </Tag>
                    </Td>
                    <Td>
                      <LinkBtn href={`/admin/grupos/${g.id}`} variant="ghost">
                        Detalle →
                      </LinkBtn>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {groups.map((g) => (
              <MobileRow
                key={g.id}
                href={`/admin/grupos/${g.id}`}
                title={g.name}
                tags={
                  <Tag variant={g.status === "active" ? "accent" : "neutral"}>
                    {g.status === "active" ? "Activo" : "Inactivo"}
                  </Tag>
                }
                fields={[
                  { label: "Empresa", value: g.company.name },
                  { label: "Código", value: g.code ?? "—" },
                  { label: "Turnos", value: g._count.shifts },
                  { label: "Empleos", value: g._count.employments },
                ]}
              />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}
