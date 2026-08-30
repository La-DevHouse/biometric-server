import { allAsync, getAsync, initDb } from "@/lib/db";
import { listActiveOperations } from "@/lib/operations";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatVerifyMode } from "@/lib/verifyMode";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardMeta } from "@/components/ui/Card";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
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
}

interface RecentLog {
  io_time: string;
  user_id: string;
  display_name: string | null;
  device_name: string | null;
  verify_mode: string | null;
}

function todayPrefix(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function fmtTime(ioTime: string): string {
  // io_time is device-format YYYYMMDDhhmmss.
  if (!/^\d{14}$/.test(ioTime)) return ioTime;
  return `${ioTime.slice(6, 8)}/${ioTime.slice(4, 6)} ${ioTime.slice(8, 10)}:${ioTime.slice(10, 12)}`;
}

async function getData() {
  await initDb();

  const devices = await allAsync<DeviceRow>(
    `SELECT dev_id, fk_name, last_seen_at FROM devices ORDER BY dev_id`
  );

  const totalToday = await getAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM attendance_logs WHERE io_time LIKE ?`,
    [`${todayPrefix()}%`]
  );

  const totalUsers = await getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM users`);

  const activeOps = await listActiveOperations();

  const recentLogs = await allAsync<RecentLog>(
    `SELECT al.io_time, al.user_id, al.verify_mode,
            COALESCE(u.user_name, al.user_id) AS display_name,
            COALESCE(d.fk_name, d.dev_id) AS device_name
       FROM attendance_logs al
       LEFT JOIN devices d ON d.dev_id = al.dev_id
       LEFT JOIN users u ON u.dev_id = al.dev_id AND u.user_id = al.user_id
      ORDER BY al.received_at DESC
      LIMIT 8`
  );

  return {
    devices,
    totalToday: totalToday?.n ?? 0,
    totalUsers: totalUsers?.n ?? 0,
    activeOpsCount: activeOps.length,
    recentLogs,
  };
}

export default async function InicioPage() {
  const { devices, totalToday, totalUsers, activeOpsCount, recentLogs } = await getData();

  const onlineDevices = devices.filter((d) => isDeviceOnline(d.last_seen_at));
  const offlineDevices = devices.filter((d) => !isDeviceOnline(d.last_seen_at));

  return (
    <div className="flex flex-col gap-[22px] max-w-[1100px]">
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <StatCard
          kicker="Equipos en línea"
          value={`${onlineDevices.length} / ${devices.length}`}
          meta="visto en los últimos 30 s"
        />
        <StatCard kicker="Marcaciones hoy" value={totalToday} meta="llegan solas en tiempo real" />
        <StatCard
          kicker="Operaciones en curso"
          value={activeOpsCount}
          meta="comandos en cola o ejecutando"
        />
        <StatCard
          kicker="Usuarios registrados"
          value={totalUsers}
          meta={`en ${devices.length} equipo${devices.length === 1 ? "" : "s"}`}
        />
      </div>

      {offlineDevices.length > 0 && (
        <Card>
          <div className="flex items-center gap-3">
            <CardMeta>
              Sin conexión: {offlineDevices.map((d) => d.fk_name || d.dev_id).join(", ")}
            </CardMeta>
            <LinkBtn href="/admin/dispositivos" variant="ghost" className="ml-auto">
              Ver dispositivos →
            </LinkBtn>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-heading text-lg m-0">Últimas marcaciones</h3>
        {recentLogs.length === 0 ? (
          <EmptyState
            title="Todavía no hay marcaciones"
            description="Aparecerán aquí en tiempo real en cuanto un equipo reporte una."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Hora</Th>
                <Th>Usuario</Th>
                <Th>Dispositivo</Th>
                <Th>Verificación</Th>
              </tr>
            </thead>
            <tbody>
              {recentLogs.map((r, i) => (
                <Tr key={i}>
                  <Td>{fmtTime(r.io_time)}</Td>
                  <Td>{r.display_name}</Td>
                  <Td>{r.device_name}</Td>
                  <Td>{formatVerifyMode(r.verify_mode)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      <p className="text-xs text-text/50 max-w-md">
        Un equipo se considera en línea si reportó actividad en los últimos 30 segundos.
        Los comandos enviados a un equipo desconectado quedan en cola hasta que vuelva.
      </p>
    </div>
  );
}
