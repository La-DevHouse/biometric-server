import Link from "next/link";
import { Suspense } from "react";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { EmptyState } from "@/components/ui/EmptyState";
import { UrlFilters } from "@/components/admin/UrlFilters";
import { DEFAULT_TZ } from "@/lib/time";
import {
  AUDIT_AREAS,
  AUDIT_ENTITY_LABEL,
  AUDIT_PAGE_SIZE,
  auditActionLabel,
  auditChanges,
  auditEntityHref,
  auditEntries,
  type AuditEntry,
} from "@/lib/auditLog";

export const dynamic = "force-dynamic";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const fmtWhen = (d: Date) =>
  d.toLocaleString("es-VE", {
    timeZone: DEFAULT_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

function Subject({ e }: { e: AuditEntry }) {
  const href = auditEntityHref(e.entityType, e.entityId);
  const kind = AUDIT_ENTITY_LABEL[e.entityType] ?? e.entityType;
  const label = e.entityName ? `${kind}: ${e.entityName}` : `${kind}${e.entityId ? ` #${e.entityId}` : ""}`;
  return href ? (
    <Link href={href} className="text-accent no-underline hover:underline">
      {label}
    </Link>
  ) : (
    <span className="text-text/70">{label}</span>
  );
}

function Changes({ e }: { e: AuditEntry }) {
  const changes = auditChanges(e.before, e.after);
  if (changes.length === 0) return <span className="text-text/50">—</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-xs">
      {changes.map((c) => (
        <li key={c.field} className="[overflow-wrap:anywhere]">
          <span className="font-mono text-text/60">{c.field}</span>: {c.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Auditoría (contrato: "registro de auditoría de acciones sensibles", docs/07
 * §1.14): quién hizo qué y cuándo en el panel, con filtros por fecha, usuario y
 * área. Solo lectura — lo escribe writeAudit en cada acción.
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; usuario?: string; area?: string; pagina?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.pagina) || 1);
  const actorId = Number(sp.usuario) || undefined;
  const [users, { entries, hasMore }] = await Promise.all([
    prisma.app_user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    auditEntries({
      from: sp.from && YMD.test(sp.from) ? sp.from : undefined,
      to: sp.to && YMD.test(sp.to) ? sp.to : undefined,
      actorId,
      area: sp.area,
      page,
    }),
  ]);
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v && k !== "pagina") q.set(k, v);
    if (p > 1) q.set("pagina", String(p));
    const s = q.toString();
    return `/admin/auditoria${s ? `?${s}` : ""}`;
  };

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <p className="m-0 text-sm text-text/75">
          Quién hizo qué y cuándo en el panel: altas y cambios, correcciones de asistencia, exportes y reportes,
          equipos y cuentas. No se puede editar ni borrar.
        </p>
        <Suspense fallback={<div className="h-(--control-h) w-(--control-h)" />}>
          <UrlFilters
            fields={[
              { name: "from", label: "Desde", type: "date" },
              { name: "to", label: "Hasta", type: "date" },
              { name: "usuario", label: "Usuario", type: "select", emptyLabel: "todos", options: users.map((u) => ({ value: String(u.id), label: u.name })) },
              { name: "area", label: "Área", type: "select", emptyLabel: "todas", options: AUDIT_AREAS.map((a) => ({ value: a.value, label: a.label })) },
            ]}
          />
        </Suspense>
      </div>

      {entries.length === 0 ? (
        <EmptyState title="Nada registrado con esos filtros" description="Pruebe con otro rango de fechas, usuario o área." />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Usuario</Th>
                  <Th>Acción</Th>
                  <Th>Sobre</Th>
                  <Th>Cambios</Th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap font-mono text-xs">{fmtWhen(e.at)}</Td>
                    <Td className="whitespace-nowrap">{e.actor ?? <span className="text-text/60">Sistema</span>}</Td>
                    <Td>{auditActionLabel(e.action)}</Td>
                    <Td>
                      <Subject e={e} />
                    </Td>
                    <Td className="max-w-md">
                      <Changes e={e} />
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {entries.map((e) => (
              <MobileRow
                key={e.id}
                title={auditActionLabel(e.action)}
                tags={<span className="font-mono text-xs text-text/60">{fmtWhen(e.at)}</span>}
                fields={[
                  { label: "Usuario", value: e.actor ?? "Sistema" },
                  { label: "Sobre", value: <Subject e={e} /> },
                  { label: "Cambios", value: <Changes e={e} /> },
                ]}
              />
            ))}
          </MobileList>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text/70">
              {page > 1 || hasMore
                ? `Página ${page} (${AUDIT_PAGE_SIZE} por página)`
                : `${entries.length} registro${entries.length === 1 ? "" : "s"}`}
            </span>
            <span className="flex gap-4">
              {page > 1 && (
                <Link href={pageHref(page - 1)} className="text-accent no-underline hover:underline">
                  ← Más recientes
                </Link>
              )}
              {hasMore && (
                <Link href={pageHref(page + 1)} className="text-accent no-underline hover:underline">
                  Más antiguos →
                </Link>
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
