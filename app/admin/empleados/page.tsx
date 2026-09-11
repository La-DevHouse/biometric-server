import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { EmployeeFormDialog } from "@/components/admin/EmployeeFormDialog";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string;
  grupo?: string;
  empresa?: string;
  sede?: string;
  estado?: string;
}>;

export default async function EmpleadosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const grupoId = sp.grupo ? Number(sp.grupo) : null;
  const empresaId = sp.empresa ? Number(sp.empresa) : null;
  const siteId = sp.sede ? Number(sp.sede) : null;
  const estado = sp.estado === "pool" ? "pool" : sp.estado === "activo" ? "activo" : null;

  const where: Record<string, unknown> = {};
  const and: Record<string, unknown>[] = [];
  if (q) {
    and.push({
      OR: [
        { first_name: { contains: q, mode: "insensitive" } },
        { last_name: { contains: q, mode: "insensitive" } },
        { national_id: { contains: q.toUpperCase() } },
      ],
    });
  }
  if (estado === "pool") and.push({ employments: { none: { status: "active" } } });
  if (estado === "activo") and.push({ employments: { some: { status: "active" } } });
  // Grupo: la empresa raíz o cualquiera de sus hijas.
  if (grupoId)
    and.push({
      employments: {
        some: { status: "active", company: { OR: [{ id: grupoId }, { parent_id: grupoId }] } },
      },
    });
  if (empresaId)
    and.push({ employments: { some: { status: "active", company_id: empresaId } } });
  if (siteId) and.push({ employments: { some: { status: "active", site_id: siteId } } });
  if (and.length) where.AND = and;

  const [employees, companies, groups, sites] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: {
        employments: {
          where: { status: "active" },
          include: { company: { select: { name: true } }, site: { select: { name: true } } },
        },
        _count: { select: { fingerprints: true } },
      },
      orderBy: [{ last_name: "asc" }, { first_name: "asc" }],
      take: 300,
    }),
    prisma.client_company.findMany({
      where: { status: "active" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // Grupos = empresas raíz que agrupan hijas (docs/09 §3.12: filtro por grupo).
    prisma.client_company.findMany({
      where: { status: "active", is_group: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.site.findMany({
      where: { status: "active" },
      select: { id: true, name: true, company: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form className="flex flex-wrap items-end gap-2 text-xs" method="get">
          <label className="flex flex-col gap-1 text-text/85">
            Buscar
            <input
              name="q"
              defaultValue={q}
              placeholder="nombre o documento"
              className="min-h-9 w-52 border border-divider bg-surface px-2.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-text/85">
            Grupo
            <select name="grupo" defaultValue={grupoId ?? ""} className="min-h-9 border border-divider bg-surface px-2.5 text-sm">
              <option value="">todos</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-text/85">
            Empresa
            <select name="empresa" defaultValue={empresaId ?? ""} className="min-h-9 border border-divider bg-surface px-2.5 text-sm">
              <option value="">todas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-text/85">
            Sede
            <select name="sede" defaultValue={siteId ?? ""} className="min-h-9 border border-divider bg-surface px-2.5 text-sm">
              <option value="">todas</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company.name} — {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-text/85">
            Estado
            <select name="estado" defaultValue={estado ?? ""} className="min-h-9 border border-divider bg-surface px-2.5 text-sm">
              <option value="">todos</option>
              <option value="activo">Con empleo activo</option>
              <option value="pool">Pool (sin vínculo)</option>
            </select>
          </label>
          <button type="submit" className="min-h-9 border border-divider px-3 text-sm">
            Filtrar
          </button>
          {(q || grupoId || empresaId || siteId || estado) && (
            <Link href="/admin/empleados" className="min-h-9 self-center text-accent no-underline hover:underline">
              limpiar
            </Link>
          )}
        </form>
        <EmployeeFormDialog />
      </div>

      <p className="m-0 text-sm text-text/75">
        {employees.length} {employees.length === 1 ? "persona" : "personas"}
        {employees.length === 300 && " (mostrando las primeras 300)"}
      </p>

      {employees.length === 0 ? (
        <EmptyState title="Sin resultados" description="Ajustá los filtros o registrá una persona nueva." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Persona</Th>
              <Th>Documento</Th>
              <Th>Empresa(s) / sede(s) activa(s)</Th>
              <Th>Huella</Th>
              <Th>Estado</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <Tr key={e.id}>
                <Td className="font-medium">
                  {e.last_name}, {e.first_name}
                </Td>
                <Td className="font-mono text-xs">{e.national_id}</Td>
                <Td className="text-xs">
                  {e.employments.length ? (
                    e.employments
                      .map((em) => `${em.company.name}${em.site ? ` (${em.site.name})` : ""}`)
                      .join(", ")
                  ) : (
                    <span className="text-text/60">—</span>
                  )}
                </Td>
                <Td>
                  {e._count.fingerprints > 0 ? (
                    <Tag variant="accent">Sí</Tag>
                  ) : (
                    <Tag variant="neutral">No</Tag>
                  )}
                </Td>
                <Td>
                  {e.employments.length ? (
                    <Tag variant="accent">Activo</Tag>
                  ) : (
                    <Tag variant="neutral">Pool</Tag>
                  )}
                </Td>
                <Td>
                  <LinkBtn href={`/admin/empleados/${e.id}`} variant="ghost">
                    Detalle →
                  </LinkBtn>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
