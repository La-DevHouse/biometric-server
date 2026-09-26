import Link from "next/link";
import { initDb, prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpButton } from "@/components/admin/OpButton";
import { SyncHoldActions } from "@/components/admin/SyncHoldActions";
import { syncDeviceNowAction } from "@/app/admin/actions";
import { deviceSyncState } from "@/lib/sync/reconcile";
import { cx } from "@/lib/cx";

// force-dynamic: pega a Postgres en un Server Component; con `revalidate` Next
// intenta prerenderizar en build y la BD no resuelve en el builder de Coolify.
export const dynamic = "force-dynamic";

function fmtDateTime(d: Date | null | undefined): string {
  return d ? d.toLocaleString("es-VE", { timeZone: "America/Caracas", dateStyle: "short", timeStyle: "short" }) : "—";
}

/**
 * Enrolamiento (docs/10 §6): vista de SOLO LECTURA de los desajustes. La
 * vinculación empleado ↔ usuario del equipo es automática por cédula y la
 * mantiene el reconciliador; acá se ve qué haría (o está frenado) en cada equipo.
 */
export default async function EnrolamientoPage({ searchParams }: { searchParams: Promise<{ dev?: string }> }) {
  await requireUser();
  await initDb();
  const { dev } = await searchParams;

  const devices = await prisma.devices.findMany({
    orderBy: { dev_id: "asc" },
    select: {
      dev_id: true,
      fk_name: true,
      site: { select: { name: true, company: { select: { name: true } } } },
      sync_runs: {
        where: { kind: "fingerprints", finished_at: { not: null } },
        orderBy: { started_at: "desc" },
        take: 1,
        select: { finished_at: true, ok: true, trigger: true },
      },
      sync_holds: { where: { resolved_at: null }, select: { id: true, planned_removals: true } },
    },
  });

  if (devices.length === 0) {
    return <EmptyState title="Todavía no hay dispositivos" description="Aparecen en cuanto un equipo se conecta." />;
  }

  const states = new Map(await Promise.all(devices.map(async (d) => [d.dev_id, await deviceSyncState(d.dev_id)] as const)));
  const selected = devices.find((d) => d.dev_id === dev) ?? null;

  return (
    <div className="flex max-w-[1100px] flex-col gap-5">
      <p className="m-0 text-sm text-text/75">
        Cada persona se vincula sola con su usuario del equipo por cédula, y el reconciliador agrega, completa y quita
        según el alcance (cada 30 min y ante cada cambio). Acá se ve lo que queda pendiente en cada equipo, según su
        última lectura.
      </p>

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/75">Equipos</h3>
        <div className="hidden md:block">
          <Table>
            <thead>
              <tr>
                <Th>Equipo</Th>
                <Th>Empresa · Sede</Th>
                <Th>Última corrida</Th>
                <Th>Faltan</Th>
                <Th>Incompletos</Th>
                <Th>Sobran</Th>
                <Th>Sin empleado</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => {
                const st = states.get(d.dev_id)!;
                const run = d.sync_runs[0];
                return (
                  <Tr key={d.dev_id} className={cx(d.dev_id === dev && "bg-accent-100")}>
                    <Td>{d.fk_name || d.dev_id}</Td>
                    <Td className="text-xs">
                      {d.site ? `${d.site.company.name} · ${d.site.name}` : <Tag variant="neutral">pendiente de asignar</Tag>}
                    </Td>
                    <Td className="text-xs">
                      {run ? `${fmtDateTime(run.finished_at)}${run.ok === false ? " (error)" : ""}` : "—"}
                    </Td>
                    {st.frozen ? (
                      <td className="p-2 border-b border-neutral-200 text-xs text-text/60" colSpan={4}>
                        congelado — sin sede activa, no se sincroniza
                      </td>
                    ) : (
                      <>
                        <Td>{st.plan!.add.length}</Td>
                        <Td>{st.plan!.complete.length}</Td>
                        <Td>
                          {st.plan!.remove.length + st.plan!.held.length}
                          {d.sync_holds.length > 0 && <Tag variant="neutral"> frenado</Tag>}
                        </Td>
                        <Td>{st.plan!.unknownUsers.length}</Td>
                      </>
                    )}
                    <Td>
                      <Link href={`/admin/enrolamiento?dev=${d.dev_id}`} className="text-xs text-accent no-underline hover:underline">
                        Detalle →
                      </Link>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        </div>
        <MobileList>
          {devices.map((d) => {
            const st = states.get(d.dev_id)!;
            return (
              <MobileRow
                key={d.dev_id}
                href={`/admin/enrolamiento?dev=${d.dev_id}`}
                title={d.fk_name || d.dev_id}
                tags={st.frozen ? <Tag variant="neutral">congelado</Tag> : undefined}
                fields={
                  st.frozen
                    ? [{ label: "Sede", value: "pendiente de asignar" }]
                    : [
                        { label: "Faltan", value: st.plan!.add.length },
                        { label: "Sobran", value: st.plan!.remove.length + st.plan!.held.length },
                        { label: "Sin empleado", value: st.plan!.unknownUsers.length },
                      ]
                }
              />
            );
          })}
        </MobileList>
      </section>

      {selected && <DeviceDetail device={selected} state={states.get(selected.dev_id)!} />}
    </div>
  );
}

async function DeviceDetail({
  device,
  state,
}: {
  device: { dev_id: string; fk_name: string | null; sync_holds: Array<{ id: number; planned_removals: unknown }> };
  state: Awaited<ReturnType<typeof deviceSyncState>>;
}) {
  const [users, slots, employees] = await Promise.all([
    prisma.users.findMany({ where: { dev_id: device.dev_id }, select: { user_id: true, user_name: true, user_privilege: true } }),
    prisma.device_fingerprint_slot.findMany({ where: { dev_id: device.dev_id }, select: { device_user_id: true, origin: true } }),
    prisma.employee.findMany({
      where: { id: { in: [...state.employeeByUser.values()] } },
      select: { id: true, first_name: true, last_name: true },
    }),
  ]);
  const empName = new Map(employees.map((e) => [e.id, `${e.last_name}, ${e.first_name}`]));
  const slotCount = (userId: string, origin: "physical" | "propagated") =>
    slots.filter((s) => s.device_user_id === userId && s.origin === origin).length;
  const p = state.plan;
  const byNum = (a: { user_id: string }, b: { user_id: string }) =>
    Number(a.user_id) - Number(b.user_id) || a.user_id.localeCompare(b.user_id);

  return (
    <section className="flex flex-col gap-4 border border-divider p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 font-heading text-xl font-semibold tracking-tight">{device.fk_name || device.dev_id}</h3>
        <span className="flex items-center gap-2">
          <Link href={`/admin/dispositivos/${device.dev_id}`} className="text-xs text-accent no-underline hover:underline">
            Ficha del equipo →
          </Link>
          <OpButton action={syncDeviceNowAction} hidden={{ dev_id: device.dev_id }} title="Sincronizar ahora">
            Sincronizar ahora
          </OpButton>
        </span>
      </div>

      {state.frozen ? (
        <p className="m-0 text-sm text-text/70">
          Sin sede activa: el equipo está congelado, no se agrega ni se quita a nadie. Asignalo a una sede desde su ficha.
        </p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <Bucket title="Faltan en el equipo (se agregan)" empty="Nadie.">
            {p!.add.map((e) => `${e.name} (${e.cedula})`)}
          </Bucket>
          <Bucket title="Con huellas incompletas (se completan)" empty="Nadie.">
            {p!.complete.map((e) => `${e.name} (${e.cedula}) — faltan ${e.missingFingerprints}`)}
          </Bucket>
          <Bucket title="Fuera del alcance (se quitan)" empty="Nadie." tone={p!.remove.length ? "warn" : undefined}>
            {p!.remove.map((r) => `${empName.get(r.employeeId) ?? r.userId} (${r.userId})`)}
          </Bucket>
          <Bucket title="Admins fuera del alcance (nunca se tocan)" empty="Nadie.">
            {p!.protectedUsers.map((u) => {
              const eid = state.employeeByUser.get(u);
              return `${eid ? empName.get(eid) : u} (${u}) — ${state.deviceUsers.get(u) ?? "privilegio desconocido"}`;
            })}
          </Bucket>
          <Bucket
            title="IDs que no son la cédula de ningún empleado (no se tocan)"
            empty="Ninguno."
            hint="Si es alguien con un ID viejo (no su cédula): una vez que su copia con cédula esté en el equipo, borrá el ID viejo desde Usuarios de equipo y sus marcaciones pasan a la cédula (docs/10 §4.5)."
          >
            {p!.unknownUsers.map((u) => `${u} — ${users.find((x) => x.user_id === u)?.user_name ?? "?"}`)}
          </Bucket>
        </div>
      )}

      {device.sync_holds.map((h) => (
        <div key={h.id} className="flex flex-col gap-2 border border-accent2 p-3">
          <p className="m-0 text-sm">
            <strong>Bajas frenadas</strong> (más de las que se permiten de una vez):{" "}
            <span className="font-mono">
              {(h.planned_removals as Array<{ user_id: string }>).map((r) => r.user_id).join(", ")}
            </span>
          </p>
          <SyncHoldActions holdId={h.id} />
        </div>
      ))}

      <div>
        <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-text/75">
          Usuarios del equipo ({users.length}, según la última lectura)
        </h4>
        {users.length === 0 ? (
          <p className="m-0 text-sm text-text/70">Sin lectura todavía — usá “Sincronizar ahora”.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>ID</Th>
                <Th>Nombre en equipo</Th>
                <Th>Privilegio</Th>
                <Th>Empleado</Th>
                <Th>Huellas (físicas / copiadas)</Th>
              </tr>
            </thead>
            <tbody>
              {[...users].sort(byNum).map((u) => {
                const eid = state.employeeByUser.get(u.user_id);
                return (
                  <Tr key={u.user_id}>
                    <Td className="font-mono">{u.user_id}</Td>
                    <Td>{u.user_name ?? "—"}</Td>
                    <Td className="text-xs">{u.user_privilege ?? "—"}</Td>
                    <Td>
                      {eid ? (
                        <Link href={`/admin/empleados/${eid}`} className="text-accent no-underline hover:underline">
                          {empName.get(eid)}
                        </Link>
                      ) : (
                        <Tag variant="neutral">sin empleado</Tag>
                      )}
                    </Td>
                    <Td className="text-xs">
                      {slotCount(u.user_id, "physical")} / {slotCount(u.user_id, "propagated")}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </div>
    </section>
  );
}

function Bucket({
  title,
  empty,
  hint,
  tone,
  children,
}: {
  title: string;
  empty: string;
  hint?: string;
  tone?: "warn";
  children: string[];
}) {
  return (
    <div className={cx("flex flex-col gap-1 border p-3 text-sm", tone === "warn" ? "border-accent2" : "border-divider")}>
      <p className="m-0 text-xs font-semibold uppercase tracking-wide text-text/70">
        {title} · {children.length}
      </p>
      {children.length === 0 ? (
        <p className="m-0 text-text/60">{empty}</p>
      ) : (
        <ul className="m-0 pl-4">
          {children.slice(0, 50).map((c) => (
            <li key={c}>{c}</li>
          ))}
          {children.length > 50 && <li>… y {children.length - 50} más.</li>}
        </ul>
      )}
      {hint && children.length > 0 && <p className="m-0 text-xs text-text/60">{hint}</p>}
    </div>
  );
}
