import { notFound } from "next/navigation";
import { getAsync, initDb } from "@/lib/db";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { Card, CardMeta } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
import { OpButton } from "@/components/admin/OpButton";
import { RenameDeviceDialog } from "@/components/admin/RenameDeviceDialog";
import { ClearLogsDialog } from "@/components/admin/ClearLogsDialog";
import { ClearEnrollDialog } from "@/components/admin/ClearEnrollDialog";
import { syncClockAction, refreshStatusAction } from "@/app/admin/actions";

export const revalidate = 3;

interface DeviceDetail {
  dev_id: string;
  fk_name: string | null;
  firmware: string | null;
  last_seen_at: number | null;
  stat_fp_count: number | null;
  stat_log_count: number | null;
  stat_updated_at: number | null;
}

async function getData(devId: string) {
  await initDb();
  const device = await getAsync<DeviceDetail>(
    `SELECT dev_id, fk_name, firmware, last_seen_at, stat_fp_count, stat_log_count, stat_updated_at
       FROM devices WHERE dev_id = ?`,
    [devId]
  );
  if (!device) return null;

  const userCount = await getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE dev_id = ?`, [
    devId,
  ]);

  return { device, userCount: userCount?.n ?? 0 };
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ devId: string }>;
}) {
  const { devId } = await params;
  const data = await getData(devId);
  if (!data) notFound();

  const { device, userCount } = data;
  const online = isDeviceOnline(device.last_seen_at);

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <LinkBtn href="/admin/dispositivos" variant="ghost" className="self-start">
        ← Dispositivos
      </LinkBtn>

      <div className="flex items-center gap-4 flex-wrap">
        <h3 className="font-heading text-2xl m-0">{device.fk_name || device.dev_id}</h3>
        <Tag variant={online ? "accent" : "neutral"}>{online ? "En línea" : "Desconectado"}</Tag>
        <span className="text-sm text-text/50 font-mono">{device.dev_id}</span>
        <span className="text-sm text-text/50">· {formatRelativeTime(device.last_seen_at)}</span>
        <div className="ml-auto flex gap-2">
          <RenameDeviceDialog devId={device.dev_id} currentName={device.fk_name || device.dev_id} />
          <OpButton action={syncClockAction} hidden={{ dev_id: device.dev_id }}>
            Sincronizar hora ahora
          </OpButton>
        </div>
      </div>

      {!online && (
        <Card>
          <CardMeta>
            Este equipo está desconectado. Puedes encolar operaciones; se ejecutarán cuando vuelva a
            reportarse.
          </CardMeta>
        </Card>
      )}

      <div
        className="grid gap-[18px]"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}
      >
        <StatCard
          kicker="Usuarios"
          value={userCount}
          linkHref={`/admin/usuarios?dev=${device.dev_id}`}
          linkLabel="Gestionar usuarios"
        />
        <StatCard
          kicker="Huellas enroladas"
          value={device.stat_fp_count ?? "—"}
          meta="solo metadata — no se pueden copiar entre equipos"
        />
        <StatCard
          kicker="Marcaciones en memoria"
          value={device.stat_log_count ?? "—"}
          linkHref={`/admin/asistencia?dev=${device.dev_id}`}
          linkLabel="Ver marcaciones"
        />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {device.stat_updated_at ? (
          <p className="text-xs text-text/50 m-0">
            Estado del equipo actualizado {formatRelativeTime(device.stat_updated_at)}.
          </p>
        ) : (
          <p className="text-xs text-text/50 m-0">
            El estado del equipo (huellas y marcaciones en memoria) aún no se ha consultado —
            &quot;Huellas enroladas&quot; y &quot;Marcaciones en memoria&quot; no son 0, simplemente no
            se han pedido todavía.
          </p>
        )}
        <OpButton action={refreshStatusAction} hidden={{ dev_id: device.dev_id }} variant="ghost">
          Actualizar estado
        </OpButton>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="font-heading text-lg m-0">Zona de riesgo</h4>
        <p className="text-sm text-text/50 max-w-lg">
          Estas acciones borran datos del equipo físico y no se pueden deshacer. El servidor conserva
          lo ya sincronizado.
        </p>
        <div className="flex gap-2">
          <ClearLogsDialog devId={device.dev_id} />
          <ClearEnrollDialog devId={device.dev_id} />
        </div>
      </div>
    </div>
  );
}
