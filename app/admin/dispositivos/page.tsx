import { allAsync, initDb } from "@/lib/db";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
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
}

async function getData() {
  await initDb();
  return allAsync<DeviceRow>(
    `SELECT d.dev_id, d.fk_name, d.last_seen_at,
            COUNT(c.trans_id) FILTER (WHERE c.status = 'WAIT') AS pending
       FROM devices d
       LEFT JOIN commands c ON c.dev_id = d.dev_id
      GROUP BY d.dev_id
      ORDER BY d.dev_id`
  );
}

export default async function DispositivosPage() {
  const devices = await getData();

  if (devices.length === 0) {
    return (
      <EmptyState
        title="Todavía no hay dispositivos"
        description="Aparecerán aquí en cuanto un equipo se conecte por primera vez."
      />
    );
  }

  return (
    <Table>
      <thead>
        <tr>
          <Th>Estado</Th>
          <Th>Nombre</Th>
          <Th>Serial</Th>
          <Th>Última conexión</Th>
          <Th>Pendientes</Th>
          <Th />
        </tr>
      </thead>
      <tbody>
        {devices.map((d) => {
          const online = isDeviceOnline(d.last_seen_at);
          return (
            <Tr key={d.dev_id}>
              <Td>
                <Tag variant={online ? "accent" : "neutral"}>
                  {online ? "En línea" : "Desconectado"}
                </Tag>
              </Td>
              <Td>{d.fk_name || <span className="text-text/50">Sin nombre</span>}</Td>
              <Td className="font-mono">{d.dev_id}</Td>
              <Td>{formatRelativeTime(d.last_seen_at)}</Td>
              <Td>{d.pending > 0 ? d.pending : <span className="text-text/50">—</span>}</Td>
              <Td>
                <LinkBtn href={`/admin/dispositivos/${d.dev_id}`} variant="ghost">
                  Detalle →
                </LinkBtn>
              </Td>
            </Tr>
          );
        })}
      </tbody>
    </Table>
  );
}
