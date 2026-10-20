import Link from "next/link";
import { requireAccess } from "@/lib/access";
import { dashboard, type CompanyYesterday } from "@/lib/dashboard";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardMeta } from "@/components/ui/Card";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";

// force-dynamic (no ISR): con Postgres, `revalidate` haría que Next intente
// prerenderizar esta página en `next build` — lo que exige la base accesible en
// build time. El panel es para pocos usuarios internos y quiere datos en vivo igual.
export const dynamic = "force-dynamic";

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const fmtYmd = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
const weekday = (ymd: string) => WEEKDAY[new Date(`${ymd}T12:00:00Z`).getUTCDay()];
/** io_time "YYYYMMDDhhmmss" → "19/10 08:25". */
const fmtMark = (io: string) => (/^\d{14}$/.test(io) ? `${io.slice(6, 8)}/${io.slice(4, 6)} ${io.slice(8, 10)}:${io.slice(10, 12)}` : io);
const dash = (v: number) => (v ? v : "—");

/**
 * Inicio: cómo fue ayer, qué requiere atención y cada empresa (docs/11). Todo
 * dentro del alcance de la cuenta (docs/18): un Socio ve solo sus empresas.
 */
export default async function InicioPage() {
  const access = await requireAccess();
  const d = await dashboard(access.companyIds);
  const daysUrl = (companyId: number, extra = "") =>
    `/admin/empresas/${companyId}/asistencia?vista=dias&from=${d.summaryDay}&to=${d.summaryDay}${extra}`;
  const isYesterday = d.summaryDay === d.yesterday;
  const dayTitle = `${isYesterday ? "Ayer" : "Último día laborable"}, ${weekday(d.summaryDay)} ${fmtYmd(d.summaryDay)}`;

  // Lo que conviene revisar, solo si hay algo.
  const attention: { label: string; detail: string; href?: string }[] = [];
  if (d.devices.offline.length)
    attention.push({
      label: `${d.devices.offline.length} equipo${d.devices.offline.length === 1 ? "" : "s"} sin conexión`,
      detail: d.devices.offline
        .slice(0, 4)
        .map((x) => `${x.name} (${formatRelativeTime(x.lastSeen)})`)
        .join(", ") + (d.devices.offline.length > 4 ? "…" : ""),
      href: "/admin/dispositivos?estado=offline",
    });
  if (access.isAdmin && d.devices.unassigned)
    attention.push({
      label: `${d.devices.unassigned} equipo${d.devices.unassigned === 1 ? "" : "s"} sin sede`,
      detail: "Se conectaron pero no están asignados: no sincronizan huellas ni cuentan marcaciones.",
      href: "/admin/dispositivos?estado=pendiente",
    });
  if (d.attention.withoutSchedule)
    attention.push({
      label: `${d.attention.withoutSchedule} contrato${d.attention.withoutSchedule === 1 ? "" : "s"} vigente${d.attention.withoutSchedule === 1 ? "" : "s"} sin horario`,
      detail: "Solo cuentan horas: sin tardanzas ni ausencias. Asígneles uno en Empresa → Empleados.",
    });
  if (d.attention.unmatchedIds)
    attention.push({
      label: `${d.attention.unmatchedIds} ID${d.attention.unmatchedIds === 1 ? "" : "s"} de equipo sin empleado`,
      detail: "Marcaron en los últimos 7 días con un ID que no es la cédula de nadie registrado: no salen en el export.",
    });
  if (d.attention.pendingHolds)
    attention.push({
      label: `${d.attention.pendingHolds} baja${d.attention.pendingHolds === 1 ? "" : "s"} de equipo por aprobar`,
      detail: "La sincronización frenó un borrado grande de usuarios y espera su aprobación en el equipo.",
      href: "/admin/dispositivos",
    });
  if (d.attention.corrections7d)
    attention.push({
      label: `${d.attention.corrections7d} corrección${d.attention.corrections7d === 1 ? "" : "es"} manual${d.attention.corrections7d === 1 ? "" : "es"} esta semana`,
      detail: "Marcaciones agregadas o anuladas a mano, con su motivo.",
      href: access.isAdmin ? "/admin/auditoria?area=asistencia" : undefined,
    });

  const issues = (c: CompanyYesterday) => c.late + c.earlyLeave + c.absent + c.incomplete;
  const shown = d.perCompany.slice(0, 15);

  return (
    <div className="flex max-w-[1100px] flex-col gap-[22px]">
      <div className="grid gap-[18px]" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        <StatCard
          kicker="Equipos en línea"
          value={`${d.devices.online} / ${d.devices.total}`}
          meta="visto en los últimos 30 s"
          tone="accent"
          href="/admin/dispositivos?estado=online"
        />
        <StatCard kicker="Marcaciones hoy" value={d.marksToday} meta="llegan solas en tiempo real" tone="accent2" />
        <StatCard
          kicker="Personas con contrato"
          value={d.people}
          meta={`en ${d.companies} empresa${d.companies === 1 ? "" : "s"}`}
          tone="accent"
          href="/admin/empleados?estado=activo"
        />
        <StatCard
          kicker={isYesterday ? "Incidencias de ayer" : `Incidencias del ${weekday(d.summaryDay)}`}
          value={d.day.late + d.day.earlyLeave + d.day.absent + d.day.incomplete}
          meta={d.day.total ? "tardanzas, salidas, ausencias e incompletos" : "todavía no se calculó"}
          tone="accent2"
        />
      </div>

      <section className="flex flex-col gap-2" aria-labelledby="ayer">
        <h3 id="ayer" className="m-0 font-heading text-xl font-semibold tracking-tight">
          {dayTitle}
        </h3>
        {d.day.total === 0 ? (
          <p className="m-0 text-sm text-text/70">
            Todavía no hay días laborables calculados en la última semana. La asistencia se calcula cada noche (4:30); para no esperar, use
            “Recalcular asistencia” en la empresa.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Presentes", v: d.day.present, variant: "accent" as const },
              { label: "Tardanzas", v: d.day.late, variant: "accent2" as const },
              { label: "Salidas anticipadas", v: d.day.earlyLeave, variant: "accent2" as const },
              { label: "Ausencias", v: d.day.absent, variant: "accent2" as const },
              { label: "Incompletos", v: d.day.incomplete, variant: "neutral" as const },
            ].map((x) => (
              <span key={x.label} className="inline-flex items-center gap-2 border border-divider bg-surface px-3 py-2 text-sm">
                <span className="font-mono text-lg font-semibold">{x.v}</span>
                <Tag variant={x.variant}>{x.label}</Tag>
              </span>
            ))}
          </div>
        )}
      </section>

      {attention.length > 0 && (
        <Card>
          <h3 className="m-0 mb-2 font-heading text-lg font-semibold tracking-tight">Requiere atención</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {attention.map((a) => (
              <li key={a.label} className="flex flex-col gap-0.5 border-l-2 border-accent2 pl-3">
                {a.href ? (
                  <Link href={a.href} className="text-sm font-semibold text-accent no-underline hover:underline">
                    {a.label} →
                  </Link>
                ) : (
                  <span className="text-sm font-semibold">{a.label}</span>
                )}
                <CardMeta>{a.detail}</CardMeta>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <section className="flex flex-col gap-2" aria-labelledby="empresas">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="empresas" className="m-0 font-heading text-xl font-semibold tracking-tight">
            Empresas — {isYesterday ? "ayer" : `${weekday(d.summaryDay)} ${fmtYmd(d.summaryDay).slice(0, 5)}`}
          </h3>
          <Link href="/admin/empresas" className="text-sm text-accent no-underline hover:underline">
            Todas las empresas →
          </Link>
        </div>
        {shown.length === 0 ? (
          <EmptyState title="Sin empresas con contratos" description="Cuando haya contratos vigentes, aquí verá cómo fue el último día laborable en cada empresa." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Empresa</Th>
                    <Th>Contratos</Th>
                    <Th>Presentes</Th>
                    <Th>Tardanzas</Th>
                    <Th>Salidas antic.</Th>
                    <Th>Ausencias</Th>
                    <Th>Incompletos</Th>
                    <Th>Sin horario</Th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <Tr key={c.id}>
                      <Td>
                        <Link href={daysUrl(c.id)} className="font-medium text-accent no-underline hover:underline">
                          {c.name}
                        </Link>
                      </Td>
                      <Td>{c.contracts}</Td>
                      <Td>{c.total ? dash(c.present) : <span className="whitespace-nowrap text-text/50">sin calcular</span>}</Td>
                      <Td>{c.late ? <Link href={daysUrl(c.id, "&estado=late")} className="text-accent no-underline hover:underline">{c.late}</Link> : "—"}</Td>
                      <Td>{c.earlyLeave ? <Link href={daysUrl(c.id, "&estado=early_leave")} className="text-accent no-underline hover:underline">{c.earlyLeave}</Link> : "—"}</Td>
                      <Td>{c.absent ? <Link href={daysUrl(c.id, "&estado=absent")} className="text-accent no-underline hover:underline">{c.absent}</Link> : "—"}</Td>
                      <Td>{c.incomplete ? <Link href={daysUrl(c.id, "&estado=incomplete")} className="text-accent no-underline hover:underline">{c.incomplete}</Link> : "—"}</Td>
                      <Td>
                        {c.withoutSchedule ? (
                          <Link href={`/admin/empresas/${c.id}/empleados`} className="text-accent no-underline hover:underline">
                            {c.withoutSchedule}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <MobileList>
              {shown.map((c) => (
                <MobileRow
                  key={c.id}
                  title={c.name}
                  href={daysUrl(c.id)}
                  tags={issues(c) ? <Tag variant="accent2">{issues(c)} incidencia{issues(c) === 1 ? "" : "s"}</Tag> : undefined}
                  fields={[
                    { label: "Contratos / presentes", value: `${c.contracts} / ${c.total ? c.present : "sin calcular"}` },
                    { label: "Tardanzas / ausencias", value: `${c.late} / ${c.absent}` },
                    { label: "Sin horario", value: String(c.withoutSchedule) },
                  ]}
                />
              ))}
            </MobileList>
            {d.perCompany.length > shown.length && (
              <p className="m-0 text-xs text-text/70">
                Mostrando las {shown.length} con más incidencias de {d.perCompany.length}.
              </p>
            )}
          </>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="ultimas">
        <h3 id="ultimas" className="m-0 font-heading text-xl font-semibold tracking-tight">
          Últimas marcaciones
        </h3>
        {d.recent.length === 0 ? (
          <EmptyState title="Todavía no hay marcaciones" description="Aparecerán aquí en tiempo real en cuanto un equipo reporte una." />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <thead>
                  <tr>
                    <Th>Hora</Th>
                    <Th>Persona</Th>
                    <Th>Empresa</Th>
                    <Th>Equipo</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.recent.map((r, i) => (
                    <Tr key={i}>
                      <Td className="whitespace-nowrap font-mono">{fmtMark(r.ioTime)}</Td>
                      <Td>
                        {r.employeeId ? (
                          <Link href={`/admin/empleados/${r.employeeId}`} className="text-accent no-underline hover:underline">
                            {r.person}
                          </Link>
                        ) : (
                          <span className="text-text/70">{r.person}</span>
                        )}
                      </Td>
                      <Td>{r.company ?? <span className="text-text/60">sin sede</span>}</Td>
                      <Td>{r.device}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            </div>
            <MobileList>
              {d.recent.map((r, i) => (
                <MobileRow
                  key={i}
                  title={r.person}
                  tags={<span className="font-mono text-xs text-text/60">{fmtMark(r.ioTime)}</span>}
                  fields={[
                    { label: "Empresa", value: r.company ?? "sin sede" },
                    { label: "Equipo", value: r.device },
                  ]}
                />
              ))}
            </MobileList>
          </>
        )}
      </section>
    </div>
  );
}
