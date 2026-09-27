import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Tabs } from "@/components/ui/Tabs";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { DepartmentFormDialog } from "@/components/admin/DepartmentFormDialog";
import { PositionFormDialog } from "@/components/admin/PositionFormDialog";
import { BusinessModelFormDialog } from "@/components/admin/BusinessModelFormDialog";
import { RecordStatusButton } from "@/components/admin/RecordStatusButton";
import {
  setDepartmentStatusAction,
  setPositionStatusAction,
  setBusinessModelStatusAction,
} from "@/app/admin/categorias/actions";

export const dynamic = "force-dynamic";

type Tab = "modelos" | "puestos" | "departamentos";

/**
 * Categorías (docs/11 P3): pestañas Modelos de negocio / Puestos /
 * Departamentos, en ese orden (departamentos está previsto pero sin uso en
 * Fase 1, docs/09 DC5). La pestaña va en `?tab=` — es una sola pantalla.
 */
export default async function CategoriasPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const tab: Tab = sp.tab === "puestos" || sp.tab === "departamentos" ? sp.tab : "modelos";
  const [departments, positions, businessModels] = await Promise.all([
    prisma.department.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { positions: true, employments: true } } },
    }),
    prisma.position.findMany({
      orderBy: { name: "asc" },
      include: {
        department: { select: { name: true } },
        business_models: { select: { business_model_id: true } },
        _count: { select: { employments: true } },
      },
    }),
    prisma.business_model.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { companies: true, positions: true } } },
    }),
  ]);
  const deptOptions = departments.map((d) => ({ id: d.id, name: d.name }));
  const bmOptions = businessModels.filter((b) => b.status === "active").map((b) => ({ id: b.id, name: b.name }));

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <Tabs
        label="Categorías"
        active={tab}
        items={[
          {
            key: "modelos",
            label: `Modelos de negocio (${businessModels.length})`,
            href: "/admin/categorias",
          },
          {
            key: "puestos",
            label: `Puestos (${positions.length})`,
            href: "/admin/categorias?tab=puestos",
          },
          {
            key: "departamentos",
            label: `Departamentos (${departments.length})`,
            href: "/admin/categorias?tab=departamentos",
          },
        ]}
      />
      {tab === "modelos" && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
              Modelos de negocio ({businessModels.length})
            </h3>
            <BusinessModelFormDialog />
          </div>
          <p className="mb-2 mt-0 text-xs text-text/60">
            Tipo de comercio de la empresa (farmacia, restaurante, colegio…). Filtra qué puestos se ofrecen al crear un
            contrato.
          </p>
          {businessModels.length === 0 ? (
            <EmptyState title="Sin modelos de negocio" description="Creá el primero." />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Nombre</Th>
                      <Th>Código</Th>
                      <Th>Empresas</Th>
                      <Th>Puestos</Th>
                      <Th>Estado</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {businessModels.map((b) => (
                      <Tr key={b.id}>
                        <Td>{b.name}</Td>
                        <Td className="font-mono text-xs">{b.code ?? <span className="text-text/60">—</span>}</Td>
                        <Td>{b._count.companies}</Td>
                        <Td>{b._count.positions}</Td>
                        <Td>
                          <Tag variant={b.status === "active" ? "accent" : "neutral"}>
                            {b.status === "active" ? "Activo" : "Inactivo"}
                          </Tag>
                        </Td>
                        <Td actions>
                          <span className="inline-flex items-center gap-1">
                            <BusinessModelFormDialog model={{ id: b.id, name: b.name, code: b.code }} />
                            <RecordStatusButton
                              id={b.id}
                              active={b.status === "active"}
                              label="modelo de negocio"
                              action={setBusinessModelStatusAction}
                            />
                          </span>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </div>
              <MobileList>
                {businessModels.map((b) => (
                  <MobileRow
                    key={b.id}
                    title={b.name}
                    tags={
                      <Tag variant={b.status === "active" ? "accent" : "neutral"}>
                        {b.status === "active" ? "Activo" : "Inactivo"}
                      </Tag>
                    }
                    fields={[
                      { label: "Código", value: b.code ?? "—" },
                      { label: "Empresas", value: b._count.companies },
                      { label: "Puestos", value: b._count.positions },
                    ]}
                    actions={
                      <>
                        <BusinessModelFormDialog model={{ id: b.id, name: b.name, code: b.code }} />
                        <RecordStatusButton
                          id={b.id}
                          active={b.status === "active"}
                          label="modelo de negocio"
                          action={setBusinessModelStatusAction}
                        />
                      </>
                    }
                  />
                ))}
              </MobileList>
            </>
          )}
        </section>
      )}
      {tab === "puestos" && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
              Puestos ({positions.length})
            </h3>
            <PositionFormDialog departments={deptOptions} businessModels={bmOptions} />
          </div>
          {positions.length === 0 ? (
            <EmptyState title="Sin puestos" description="Creá el primero." />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Nombre</Th>
                      <Th>Código</Th>
                      <Th>Departamento</Th>
                      <Th>Modelos</Th>
                      <Th>Contratos</Th>
                      <Th>Estado</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((p) => (
                      <Tr key={p.id}>
                        <Td>{p.name}</Td>
                        <Td className="font-mono text-xs">{p.code ?? <span className="text-text/60">—</span>}</Td>
                        <Td>{p.department?.name ?? <span className="text-text/60">—</span>}</Td>
                        <Td className="text-xs">
                          {p.business_models.length === 0 ? (
                            <span className="text-text/60">Genérico</span>
                          ) : (
                            p.business_models.length
                          )}
                        </Td>
                        <Td>{p._count.employments}</Td>
                        <Td>
                          <Tag variant={p.status === "active" ? "accent" : "neutral"}>
                            {p.status === "active" ? "Activo" : "Inactivo"}
                          </Tag>
                        </Td>
                        <Td actions>
                          <span className="inline-flex items-center gap-1">
                            <PositionFormDialog
                              departments={deptOptions}
                              businessModels={bmOptions}
                              position={{
                                id: p.id,
                                name: p.name,
                                code: p.code,
                                description: p.description,
                                department_id: p.department_id,
                                business_model_ids: p.business_models.map((x) => x.business_model_id),
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
              </div>
              <MobileList>
                {positions.map((p) => (
                  <MobileRow
                    key={p.id}
                    title={p.name}
                    tags={
                      <Tag variant={p.status === "active" ? "accent" : "neutral"}>
                        {p.status === "active" ? "Activo" : "Inactivo"}
                      </Tag>
                    }
                    fields={[
                      { label: "Código", value: p.code ?? "—" },
                      {
                        label: "Departamento",
                        value: p.department?.name ?? "—",
                      },
                      {
                        label: "Modelos",
                        value: p.business_models.length === 0 ? "Genérico" : p.business_models.length,
                      },
                      { label: "Contratos", value: p._count.employments },
                    ]}
                    actions={
                      <>
                        <PositionFormDialog
                          departments={deptOptions}
                          businessModels={bmOptions}
                          position={{
                            id: p.id,
                            name: p.name,
                            code: p.code,
                            description: p.description,
                            department_id: p.department_id,
                            business_model_ids: p.business_models.map((x) => x.business_model_id),
                          }}
                        />
                        <RecordStatusButton
                          id={p.id}
                          active={p.status === "active"}
                          label="puesto"
                          action={setPositionStatusAction}
                        />
                      </>
                    }
                  />
                ))}
              </MobileList>
            </>
          )}
        </section>
      )}
      {tab === "departamentos" && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="m-0 text-sm font-semibold uppercase tracking-wide text-text/75">
              Departamentos ({departments.length})
            </h3>
            <DepartmentFormDialog />
          </div>
          {departments.length === 0 ? (
            <EmptyState title="Sin departamentos" description="Creá el primero." />
          ) : (
            <>
              <div className="hidden md:block">
                <Table>
                  <thead>
                    <tr>
                      <Th>Nombre</Th>
                      <Th>Código</Th>
                      <Th>Puestos</Th>
                      <Th>Contratos</Th>
                      <Th>Estado</Th>
                      <Th />
                    </tr>
                  </thead>
                  <tbody>
                    {departments.map((d) => (
                      <Tr key={d.id}>
                        <Td>{d.name}</Td>
                        <Td className="font-mono text-xs">{d.code ?? <span className="text-text/60">—</span>}</Td>
                        <Td>{d._count.positions}</Td>
                        <Td>{d._count.employments}</Td>
                        <Td>
                          <Tag variant={d.status === "active" ? "accent" : "neutral"}>
                            {d.status === "active" ? "Activo" : "Inactivo"}
                          </Tag>
                        </Td>
                        <Td actions>
                          <span className="inline-flex items-center gap-1">
                            <DepartmentFormDialog
                              department={{
                                id: d.id,
                                name: d.name,
                                code: d.code,
                                description: d.description,
                              }}
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
              </div>
              <MobileList>
                {departments.map((d) => (
                  <MobileRow
                    key={d.id}
                    title={d.name}
                    tags={
                      <Tag variant={d.status === "active" ? "accent" : "neutral"}>
                        {d.status === "active" ? "Activo" : "Inactivo"}
                      </Tag>
                    }
                    fields={[
                      { label: "Código", value: d.code ?? "—" },
                      { label: "Puestos", value: d._count.positions },
                      { label: "Contratos", value: d._count.employments },
                    ]}
                    actions={
                      <>
                        <DepartmentFormDialog
                          department={{
                            id: d.id,
                            name: d.name,
                            code: d.code,
                            description: d.description,
                          }}
                        />
                        <RecordStatusButton
                          id={d.id}
                          active={d.status === "active"}
                          label="departamento"
                          action={setDepartmentStatusAction}
                        />
                      </>
                    }
                  />
                ))}
              </MobileList>
            </>
          )}
        </section>
      )}
    </div>
  );
}
