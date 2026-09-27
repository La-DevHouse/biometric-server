import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { getAsync, initDb, prisma } from "@/lib/db";
import { isDeviceOnline } from "@/lib/deviceStatus";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { Card, CardMeta } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { SyncHoldActions } from "@/components/admin/SyncHoldActions";
import { DeviceTabs } from "@/components/admin/DeviceTabs";

// force-dynamic: la página pega a Postgres en un Server Component; con `revalidate`
// Next intenta prerenderizarla en `next build`, lo que exige la BD accesible en
// build time (falla en Coolify: el hostname interno no resuelve en el builder).
export const dynamic = "force-dynamic";

interface DeviceDetail {
  dev_id: string;
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
    `SELECT dev_id, firmware, last_seen_at, stat_fp_count, stat_log_count, stat_updated_at,
            site_id, company_linked_at, device_admin_note
       FROM devices WHERE dev_id = ?`,
    [devId]
  );
  if (!device) return null;

  const [userCount, currentSite, lastRun, openHold] = await Promise.all([
    getAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE dev_id = ?`, [devId]),
    device.site_id != null
      ? prisma.site.findUnique({
          where: { id: device.site_id },
          select: { name: true, status: true, company: { select: { id: true, name: true } } },
        })
      : null,
    prisma.sync_run.findFirst({
      where: { dev_id: devId, kind: "fingerprints", finished_at: { not: null } },
      orderBy: { started_at: "desc" },
    }),
    prisma.sync_hold.findFirst({ where: { dev_id: devId, resolved_at: null }, orderBy: { created_at: "desc" } }),
  ]);

  return { device, userCount: userCount?.n ?? 0, currentSite, lastRun, openHold };
}

/** Equipo → Información (docs/11 E6): asignación, contadores, sincronización y bajas frenadas. */
export default async function DeviceDetailPage({ params }: { params: Promise<{ devId: string }> }) {
  await requireUser();
  const { devId } = await params;
  const data = await getData(devId);
  if (!data) notFound();

  const { device, userCount, currentSite, lastRun, openHold } = data;
  const runStats = (lastRun?.stats ?? {}) as {
    added?: number;
    completed?: number;
    removed?: number;
    unknown?: string[];
    protected?: string[];
  };
  const online = isDeviceOnline(device.last_seen_at);
  const frozen = !currentSite || currentSite.status !== "active";
  const base = `/admin/dispositivos/${device.dev_id}`;

  return (
    <div className="flex max-w-[1100px] flex-col gap-6">
      <DeviceTabs devId={device.dev_id} active="info" />

      {!online && (
        <Card>
          <CardMeta>
            Este equipo está desconectado. Puedes encolar operaciones; se ejecutarán cuando vuelva a reportarse.
          </CardMeta>
        </Card>
      )}

      <section className="flex flex-col gap-2 border border-divider p-4">
        <h3 className="m-0 font-heading text-xl font-semibold tracking-tight">Asignación</h3>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-text/70">Empresa</dt>
          <dd className="m-0">
            {currentSite ? (
              <Link href={`/admin/empresas/${currentSite.company.id}`} className="text-accent no-underline hover:underline">
                {currentSite.company.name}
              </Link>
            ) : (
              <span className="text-text/60">pendiente de asignar</span>
            )}
          </dd>
          <dt className="text-text/70">Sede</dt>
          <dd className="m-0">
            {currentSite?.name ?? <span className="text-text/60">—</span>}
            {currentSite && currentSite.status !== "active" && <span className="text-text/60"> (inactiva)</span>}
          </dd>
          {currentSite && (
            <>
              <dt className="text-text/70">Asignado desde</dt>
              <dd className="m-0">{fmtDate(device.company_linked_at)}</dd>
            </>
          )}
          {device.device_admin_note && (
            <>
              <dt className="text-text/70">Nota</dt>
              <dd className="m-0">{device.device_admin_note}</dd>
            </>
          )}
          {device.firmware && (
            <>
              <dt className="text-text/70">Firmware</dt>
              <dd className="m-0 font-mono text-xs">{device.firmware}</dd>
            </>
          )}
        </dl>
        {frozen && (
          <p className="m-0 text-xs text-text/70">
            Sin sede activa el equipo está <strong>congelado</strong>: no se agrega ni se quita a nadie hasta que tenga
            una. Asignalo con el ícono de sede de arriba.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 border border-divider p-4">
        <h3 className="m-0 font-heading text-xl font-semibold tracking-tight">Sincronización de huellas</h3>
        {frozen ? (
          <p className="m-0 text-sm text-text/70">Congelado: no se sincroniza. “Actualizar” solo lee su estado.</p>
        ) : lastRun ? (
          <div className="flex flex-col gap-1 text-sm text-text/85">
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
          <p className="m-0 text-sm text-text/70">Todavía no corrió ninguna sincronización en este equipo.</p>
        )}
        <p className="m-0 text-xs text-text/60">
          Corre sola cada 30 min y ante cada cambio de contrato o de sede. Para forzarla, “Actualizar”. El detalle por
          usuario está en{" "}
          <Link href={`${base}/usuarios`} className="text-accent no-underline hover:underline">
            Usuarios
          </Link>
          .
        </p>
        {openHold && (
          <div className="flex flex-col gap-2 border border-accent2 p-3">
            <p className="m-0 text-sm">
              <strong>Bajas frenadas:</strong> la última corrida quitaría{" "}
              {(openHold.planned_removals as unknown[]).length} usuario(s) de este equipo, más de lo que se permite de
              una vez. No se borró a nadie. Usuarios:{" "}
              <span className="font-mono">
                {(openHold.planned_removals as Array<{ user_id: string }>).map((r) => r.user_id).join(", ")}
              </span>
            </p>
            <SyncHoldActions holdId={openHold.id} />
          </div>
        )}
      </section>

      <div className="grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <StatCard kicker="Usuarios" value={userCount} linkHref={`${base}/usuarios`} linkLabel="Ver usuarios" />
        <StatCard kicker="Huellas enroladas" value={device.stat_fp_count ?? "—"} />
        <StatCard
          kicker="Marcaciones en memoria"
          value={device.stat_log_count ?? "—"}
          linkHref={`${base}/marcaciones`}
          linkLabel="Ver marcaciones"
        />
      </div>

      <p className="m-0 text-xs text-text/70">
        {device.stat_updated_at
          ? `Estado del equipo leído ${formatRelativeTime(device.stat_updated_at)}.`
          : "El estado del equipo (huellas y marcaciones en memoria) aún no se leyó — no son 0, simplemente no se pidieron todavía. Usá “Actualizar”."}
      </p>

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
