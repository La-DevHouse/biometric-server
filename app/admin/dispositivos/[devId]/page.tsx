import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAsync, initDb, prisma } from "@/lib/db";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { Card, CardMeta } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { Tag } from "@/components/ui/Tag";
import { LinkBtn } from "@/components/ui/Btn";
import { OpButton } from "@/components/admin/OpButton";
import { SyncHoldActions } from "@/components/admin/SyncHoldActions";
import { RenameDeviceDialog } from "@/components/admin/RenameDeviceDialog";
import { DeviceAssignDialog } from "@/components/admin/DeviceAssignDialog";
import { syncClockAction, refreshStatusAction, syncDeviceNowAction } from "@/app/admin/actions";

// force-dynamic: la página pega a Postgres en un Server Component; con `revalidate`
// Next intenta prerenderizarla en `next build`, lo que exige la BD accesible en
// build time (falla en Coolify: el hostname interno no resuelve en el builder).
export const dynamic = "force-dynamic";

interface DeviceDetail {
  dev_id: string;
  fk_name: string | null;
  firmware: string | null;
  last_seen_at: number | null;
  stat_fp_count: number | null;
  stat_log_count: number | null;
  stat_updated_at: number | null;
  site_id: number | null;
  company_linked_at: Date | null;
  device_admin_note: string | null;
}

function fmtDate(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : "—";
}

function fmtDateTime(d: Date): string {
  return d.toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" });
}

async function getData(devId: string) {
  await initDb();
  const device = await getAsync<DeviceDetail>(
    `SELECT dev_id, fk_name, firmware, last_seen_at, stat_fp_count, stat_log_count, stat_updated_at,
            site_id, company_linked_at, device_admin_note
       FROM devices WHERE dev_id = ?`,
    [devId]
  );
  if (!device) return null;

  const userCount = await getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE dev_id = ?`, [
    devId,
  ]);

  // Sedes asignables (activas, de empresas activas) + la sede actual aunque ya
  // no lo esté, para poder mostrarla. La empresa sale de la sede (docs/10 R3).
  const [sitesRaw, currentSite] = await Promise.all([
    prisma.site.findMany({
      where: { status: "active", company: { status: "active" } },
      select: { id: true, name: true, company_id: true, company: { select: { name: true } } },
      orderBy: [{ company: { name: "asc" } }, { name: "asc" }],
    }),
    device.site_id != null
      ? prisma.site.findUnique({
          where: { id: device.site_id },
          select: { name: true, company: { select: { name: true } } },
        })
      : null,
  ]);
  const sites = sitesRaw.map((s) => ({ id: s.id, name: s.name, company_id: s.company_id, company_name: s.company.name }));

  const [lastRun, openHold] = await Promise.all([
    prisma.sync_run.findFirst({
      where: { dev_id: devId, kind: "fingerprints", finished_at: { not: null } },
      orderBy: { started_at: "desc" },
    }),
    prisma.sync_hold.findFirst({ where: { dev_id: devId, resolved_at: null }, orderBy: { created_at: "desc" } }),
  ]);

  return { device, userCount: userCount?.n ?? 0, sites, currentSite, lastRun, openHold };
}

export default async function DeviceDetailPage({
  params,
}: {
  params: Promise<{ devId: string }>;
}) {
  await requireUser();
  const { devId } = await params;
  const data = await getData(devId);
  if (!data) notFound();

  const { device, userCount, sites, currentSite, lastRun, openHold } = data;
  const runStats = (lastRun?.stats ?? {}) as { added?: number; completed?: number; removed?: number; held?: number; unknown?: string[]; protected?: string[] };
  const online = isDeviceOnline(device.last_seen_at);
  const companyName = currentSite?.company.name ?? null;
  const siteName = currentSite?.name ?? null;

  return (
    <div className="flex flex-col gap-6 max-w-[1100px]">
      <LinkBtn href="/admin/dispositivos" variant="ghost" className="self-start">
        ← Dispositivos
      </LinkBtn>

      <div className="flex items-center gap-4 flex-wrap">
        <h3 className="font-heading text-2xl font-semibold tracking-tight m-0">{device.fk_name || device.dev_id}</h3>
        <Tag variant={online ? "accent" : "neutral"}>{online ? "En línea" : "Desconectado"}</Tag>
        <span className="text-sm text-text/70 font-mono">{device.dev_id}</span>
        <span className="text-sm text-text/70">· {formatRelativeTime(device.last_seen_at)}</span>
        <div className="ml-auto flex gap-2">
          <RenameDeviceDialog devId={device.dev_id} currentName={device.fk_name || device.dev_id} />
          <OpButton action={syncClockAction} hidden={{ dev_id: device.dev_id }} title="Sincronizar hora ahora">
            Sincronizar hora ahora
          </OpButton>
        </div>
      </div>

      <div className="flex flex-col gap-2 border border-divider p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-heading text-xl font-semibold tracking-tight m-0">Asignación</h4>
          <DeviceAssignDialog
            devId={device.dev_id}
            sites={sites}
            current={{
              site_id: device.site_id,
              note: device.device_admin_note,
            }}
          />
        </div>
        <div className="text-sm text-text/85 flex flex-col gap-1">
          <div>
            <span className="text-text/70">Empresa: </span>
            {companyName ?? <span className="text-text/60">pendiente de asignar (sin sede)</span>}
          </div>
          <div>
            <span className="text-text/70">Sede: </span>
            {siteName ?? <span className="text-text/60">—</span>}
          </div>
          {companyName && (
            <div>
              <span className="text-text/70">Asignado desde: </span>
              {fmtDate(device.company_linked_at)}
            </div>
          )}
          {device.device_admin_note && (
            <div>
              <span className="text-text/70">Nota: </span>
              {device.device_admin_note}
            </div>
          )}
        </div>
        {!companyName && (
          <p className="text-xs text-text/70 m-0">
            Sin empresa, al enrolar en este equipo la lista de empleados no se puede acotar.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 border border-divider p-4">
        <div className="flex items-center justify-between gap-3">
          <h4 className="font-heading text-xl font-semibold tracking-tight m-0">Sincronización de huellas</h4>
          <OpButton
            action={syncDeviceNowAction}
            hidden={{ dev_id: device.dev_id }}
            title="Sincronizar ahora"
            description="Relee el equipo, agrega a quien falte, copia las huellas que falten y quita a quien ya no corresponda — con las salvaguardas (nunca admins ni IDs que no sean de un empleado)."
          >
            Sincronizar ahora
          </OpButton>
        </div>
        {!companyName ? (
          <p className="text-sm text-text/70 m-0">Sin sede asignada: el equipo está congelado y no se sincroniza.</p>
        ) : lastRun ? (
          <div className="text-sm text-text/85 flex flex-col gap-1">
            <div>
              <span className="text-text/70">Última corrida: </span>
              {lastRun.finished_at ? fmtDateTime(lastRun.finished_at) : "—"} ({lastRun.trigger}
              {lastRun.ok === false ? ", con error" : ""})
            </div>
            <div className="text-xs text-text/70">
              {runStats.added ?? 0} alta(s) · {runStats.completed ?? 0} a completar · {runStats.removed ?? 0} baja(s)
              {runStats.unknown?.length ? ` · IDs sin empleado: ${runStats.unknown.join(", ")}` : ""}
              {runStats.protected?.length ? ` · admins fuera del alcance (no se tocan): ${runStats.protected.join(", ")}` : ""}
            </div>
          </div>
        ) : (
          <p className="text-sm text-text/70 m-0">Todavía no corrió ninguna sincronización en este equipo.</p>
        )}
        {openHold && (
          <div className="flex flex-col gap-2 border border-accent2 p-3">
            <p className="m-0 text-sm">
              <strong>Bajas frenadas:</strong> la última corrida quitaría{" "}
              {(openHold.planned_removals as unknown[]).length} usuario(s) de este equipo, más de lo que se
              permite de una vez. No se borró a nadie. Usuarios:{" "}
              <span className="font-mono">
                {(openHold.planned_removals as Array<{ user_id: string }>).map((r) => r.user_id).join(", ")}
              </span>
            </p>
            <SyncHoldActions holdId={openHold.id} />
          </div>
        )}
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
          <p className="text-xs text-text/70 m-0">
            Estado del equipo actualizado {formatRelativeTime(device.stat_updated_at)}.
          </p>
        ) : (
          <p className="text-xs text-text/70 m-0">
            El estado del equipo (huellas y marcaciones en memoria) aún no se ha consultado —
            &quot;Huellas enroladas&quot; y &quot;Marcaciones en memoria&quot; no son 0, simplemente no
            se han pedido todavía.
          </p>
        )}
        <OpButton action={refreshStatusAction} hidden={{ dev_id: device.dev_id }} variant="ghost" title="Actualizar estado">
          Actualizar estado
        </OpButton>
      </div>

      <p className="m-0 text-xs text-text/60">
        Borrar la memoria de logs o todos los biométricos del equipo:{" "}
        <Link href={`/admin/diagnostico?dev=${device.dev_id}`} className="text-accent no-underline hover:underline">
          Diagnóstico → Zona de riesgo
        </Link>
        .
      </p>
    </div>
  );
}
