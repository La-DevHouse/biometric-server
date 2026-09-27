import { notFound } from "next/navigation";
import { initDb, prisma } from "@/lib/db";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { Tabs, DetailHeader } from "@/components/ui/Tabs";
import { Tag } from "@/components/ui/Tag";
import { Icon } from "@/components/ui/icons";
import { OpButton } from "./OpButton";
import { RenameDeviceDialog } from "./RenameDeviceDialog";
import { DeviceAssignDialog } from "./DeviceAssignDialog";
import { syncClockAction, updateDeviceAction } from "@/app/admin/actions";

export type DeviceTab = "info" | "usuarios" | "marcaciones";

/**
 * Encabezado + pestañas de un equipo (docs/11 E3/E6): Información / Usuarios /
 * Marcaciones, con las acciones del equipo como íconos (renombrar, hora,
 * actualizar, asignar sede). Carga sus propios datos para que cada pestaña no
 * tenga que repetir la consulta; devuelve 404 si el equipo no existe.
 */
export async function DeviceTabs({ devId, active }: { devId: string; active: DeviceTab }) {
  await initDb();
  const device = await prisma.devices.findUnique({
    where: { dev_id: devId },
    select: {
      dev_id: true,
      fk_name: true,
      last_seen_at: true,
      site_id: true,
      device_admin_note: true,
      site: { select: { status: true } },
    },
  });
  if (!device) notFound();

  const sitesRaw = await prisma.site.findMany({
    where: { status: "active", company: { status: "active" } },
    select: { id: true, name: true, company_id: true, company: { select: { name: true, tax_id: true } } },
    orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
  });
  const sites = sitesRaw.map((s) => ({
    id: s.id,
    name: s.name,
    company_id: s.company_id,
    company_name: s.company.name,
    company_tax_id: s.company.tax_id,
  }));

  const lastSeen = device.last_seen_at == null ? null : Number(device.last_seen_at);
  const online = isDeviceOnline(lastSeen);
  const frozen = device.site_id == null || device.site?.status !== "active";
  const base = `/admin/dispositivos/${device.dev_id}`;

  return (
    <div className="flex flex-col gap-3">
      <DetailHeader
        backHref="/admin/dispositivos"
        backLabel="Equipos"
        title={device.fk_name || device.dev_id}
        badges={
          <>
            <Tag variant={online ? "accent" : "neutral"}>{online ? "En línea" : "Desconectado"}</Tag>
            {frozen && <Tag variant="neutral">Pendiente de asignar</Tag>}
          </>
        }
        subtitle={
          <>
            <span className="font-mono">{device.dev_id}</span> · {formatRelativeTime(lastSeen)}
          </>
        }
        actions={
          <>
            <RenameDeviceDialog devId={device.dev_id} currentName={device.fk_name || device.dev_id} />
            <OpButton
              action={syncClockAction}
              hidden={{ dev_id: device.dev_id }}
              title="Sincronizar hora"
              description="Pone el reloj del equipo en la hora del servidor (Caracas)."
              variant="icon"
            >
              {Icon.clock}
            </OpButton>
            <OpButton
              action={updateDeviceAction}
              hidden={{ dev_id: device.dev_id }}
              title="Actualizar"
              description={
                frozen
                  ? "El equipo no tiene sede (está congelado): solo se lee su estado — huellas y marcaciones en memoria. No se agrega ni se quita a nadie."
                  : "Lee el estado del equipo y sincroniza las huellas: agrega a quien falte, copia las huellas que falten y quita a quien ya no corresponda (nunca admins ni IDs que no sean de un empleado)."
              }
              variant="icon"
            >
              {Icon.refresh}
            </OpButton>
            <DeviceAssignDialog
              devId={device.dev_id}
              sites={sites}
              current={{ site_id: device.site_id, note: device.device_admin_note }}
            />
          </>
        }
      />
      <Tabs
        label="Secciones del equipo"
        active={active}
        items={[
          { key: "info", label: "Información", href: base },
          { key: "usuarios", label: "Usuarios", href: `${base}/usuarios` },
          { key: "marcaciones", label: "Marcaciones", href: `${base}/marcaciones` },
        ]}
      />
    </div>
  );
}
