import { Suspense } from "react";
import { allAsync, initDb, prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { Table, Th, Td, Tr, RowLink } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { SyncAllButton } from "@/components/admin/SyncAllButton";
import { DeviceFilters } from "@/components/admin/DeviceFilters";
import { EmptyState } from "@/components/ui/EmptyState";

// force-dynamic (no ISR): con Postgres, `revalidate` haría que Next intente
// prerenderizar esta página en `next build` — lo que exige la base accesible en
// build time. El panel es para 4 usuarios internos y quiere datos en vivo igual.
export const dynamic = "force-dynamic";

interface DeviceRow {
  dev_id: string;
  fk_name: string | null;
  last_seen_at: number | null;
  pending: number;
  company_id: number | null;
  company_name: string | null;
  site_name: string | null;
}

/** Minúsculas y sin acentos, para buscar "sede" y encontrar "Sede Álamo". */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

async function getData() {
  await initDb();
  // La empresa sale de la sede (docs/10 R3); sede o empresa inactiva = congelado,
  // pero igual se muestra a cuál pertenece.
  return allAsync<DeviceRow>(
    `SELECT d.dev_id, d.fk_name, d.last_seen_at,
            COUNT(c.trans_id) FILTER (WHERE c.status = 'WAIT') AS pending,
            s.company_id, co.name AS company_name, s.name AS site_name
       FROM devices d
       LEFT JOIN commands c ON c.dev_id = d.dev_id
       LEFT JOIN site s ON s.id = d.site_id
       LEFT JOIN client_company co ON co.id = s.company_id
      GROUP BY d.dev_id, s.company_id, co.name, s.name
      ORDER BY co.name NULLS FIRST, s.name, d.fk_name, d.dev_id`
  );
}

type SearchParams = Promise<{ q?: string; empresa?: string; estado?: string }>;

/** Lista de Equipos (docs/11 E1): empresa y sede, búsqueda y filtros. */
export default async function DispositivosPage({ searchParams }: { searchParams: SearchParams }) {
  await requireUser();
  const sp = await searchParams;
  const [all, companies] = await Promise.all([
    getData(),
    prisma.client_company.findMany({
      where: { status: "active" },
      select: { id: true, name: true, tax_id: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (all.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay equipos"
        description="Aparecerán aquí en cuanto un equipo se conecte por primera vez."
      />
    );
  }

  const q = norm((sp.q ?? "").trim());
  const empresaId = sp.empresa ? Number(sp.empresa) : null;
  const devices = all.filter((d) => {
    if (q && !norm([d.fk_name, d.dev_id, d.company_name, d.site_name].filter(Boolean).join(" ")).includes(q))
      return false;
    if (empresaId && d.company_id !== empresaId) return false;
    const online = isDeviceOnline(d.last_seen_at);
    if (sp.estado === "online" && !online) return false;
    if (sp.estado === "offline" && online) return false;
    if (sp.estado === "pendiente" && d.company_id != null) return false;
    return true;
  });

  const status = (d: DeviceRow) => {
    const online = isDeviceOnline(d.last_seen_at);
    return <Tag variant={online ? "accent" : "neutral"}>{online ? "En línea" : "Desconectado"}</Tag>;
  };
  const pendingAssign = <span className="text-text/60">pendiente de asignar</span>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <Suspense fallback={<div className="min-h-9 flex-1" />}>
          <DeviceFilters companies={companies} />
        </Suspense>
        <SyncAllButton />
      </div>
      <p className="m-0 text-sm text-text/75">
        {devices.length === all.length ? `${all.length} equipo(s)` : `${devices.length} de ${all.length} equipo(s)`}
      </p>

      {devices.length === 0 ? (
        <EmptyState title="Ningún equipo coincide" description="Probá con otra búsqueda o quitá los filtros." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Estado</Th>
                  <Th>Nombre</Th>
                  <Th>Empresa</Th>
                  <Th>Sede</Th>
                  <Th>Serial</Th>
                  <Th>Última conexión</Th>
                  <Th>Pendientes</Th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <Tr key={d.dev_id} clickable>
                    <Td>{status(d)}</Td>
                    <Td>
                      <RowLink href={`/admin/dispositivos/${d.dev_id}`}>
                        {d.fk_name || <span className="text-text/70">Sin nombre</span>}
                      </RowLink>
                    </Td>
                    <Td>{d.company_name ?? pendingAssign}</Td>
                    <Td>{d.site_name ?? <span className="text-text/60">—</span>}</Td>
                    <Td className="font-mono text-xs">{d.dev_id}</Td>
                    <Td>{formatRelativeTime(d.last_seen_at)}</Td>
                    <Td>{d.pending > 0 ? d.pending : <span className="text-text/70">—</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {devices.map((d) => (
              <MobileRow
                key={d.dev_id}
                href={`/admin/dispositivos/${d.dev_id}`}
                title={d.fk_name || "Sin nombre"}
                tags={status(d)}
                fields={[
                  { label: "Empresa", value: d.company_name ?? "pendiente de asignar" },
                  { label: "Sede", value: d.site_name ?? "—" },
                  { label: "Última conexión", value: formatRelativeTime(d.last_seen_at) },
                ]}
              />
            ))}
          </MobileList>
        </>
      )}
    </div>
  );
}
