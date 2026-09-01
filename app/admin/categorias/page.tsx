import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { DepartmentFormDialog } from "@/components/admin/DepartmentFormDialog";
import { PositionFormDialog } from "@/components/admin/PositionFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import {
  setDepartmentStatusAction,
  setPositionStatusAction,
} from "@/app/admin/categorias/actions";

export const dynamic = "force-dynamic";

export default async function CategoriasPage() {
  await requireUser();
  const [departments, positions] = await Promise.all([
    prisma.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { positions: true, employments: true } } },
    }),
    prisma.position.findMany({
      orderBy: { name: "asc" },
      include: { department: { select: { name: true } }, _count: { select: { employments: true } } },
    }),
  ]);
  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name }));

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">
            Departamentos ({departments.length})
          </h3>
          <DepartmentFormDialog />
        </div>
        {departments.length === 0 ? (
          <EmptyState title="Sin departamentos" description="Creá el primero." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Código</Th>
                <Th>Puestos</Th>
                <Th>Empleos</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <Tr key={d.id}>
                  <Td>{d.name}</Td>
                  <Td className="font-mono text-xs">{d.code ?? <span className="text-text/40">—</span>}</Td>
                  <Td>{d._count.positions}</Td>
                  <Td>{d._count.employments}</Td>
                  <Td>
                    <Tag variant={d.status === "active" ? "accent" : "neutral"}>
                      {d.status === "active" ? "Activo" : "Inactivo"}
                    </Tag>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1">
                      <DepartmentFormDialog
                        department={{ id: d.id, name: d.name, code: d.code, description: d.description }}
                      />
                      <RecordStatusButton
                        id={d.id}
                        active={d.status === "active"}
                        label="departamento"
                        action={setDepartmentStatusAction}
                      />
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/60">
            Puestos ({positions.length})
          </h3>
          <PositionFormDialog departments={deptOptions} />
        </div>
        {positions.length === 0 ? (
          <EmptyState title="Sin puestos" description="Creá el primero." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Nombre</Th>
                <Th>Código</Th>
                <Th>Departamento</Th>
                <Th>Empleos</Th>
                <Th>Estado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => (
                <Tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td className="font-mono text-xs">{p.code ?? <span className="text-text/40">—</span>}</Td>
                  <Td>{p.department?.name ?? <span className="text-text/40">—</span>}</Td>
                  <Td>{p._count.employments}</Td>
                  <Td>
                    <Tag variant={p.status === "active" ? "accent" : "neutral"}>
                      {p.status === "active" ? "Activo" : "Inactivo"}
                    </Tag>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1">
                      <PositionFormDialog
                        departments={deptOptions}
                        position={{
                          id: p.id,
                          name: p.name,
                          code: p.code,
                          description: p.description,
                          department_id: p.department_id,
                        }}
                      />
                      <RecordStatusButton
                        id={p.id}
                        active={p.status === "active"}
                        label="puesto"
                        action={setPositionStatusAction}
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
