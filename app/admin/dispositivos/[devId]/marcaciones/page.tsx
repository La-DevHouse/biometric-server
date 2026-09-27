import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { allAsync, initDb } from "@/lib/db";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { MobileList, MobileRow } from "@/components/ui/MobileRow";
import { Tag } from "@/components/ui/Tag";
import { Btn } from "@/components/ui/Btn";
import { Icon } from "@/components/ui/icons";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpButton } from "@/components/admin/OpButton";
import { DeviceTabs } from "@/components/admin/DeviceTabs";
import { syncLogsAction } from "@/app/admin/actions";
import { toDayBound, formatIoTime } from "@/lib/ioTime";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export const dynamic = "force-dynamic";

const RESULT_LIMIT = 300;

interface Row {
  id: number;
  io_time: string | null;
  user_id: string;
  employee_id: number | null;
  employee_name: string | null;
  device_user_name: string | null;
}

/**
 * Equipo → Marcaciones (docs/11 E6): todo lo marcado en ESTE equipo, incluidos
 * los IDs que no son la cédula de ningún empleado — la vista "dónde se marcó".
 * Lo que se exporta a nómina está en Empresa → Asistencia (por contrato, C4).
 */
export default async function DeviceMarcacionesPage({
  params,
  searchParams,
}: {
  params: Promise<{ devId: string }>;
  searchParams: Promise<{ from?: string; to?: string; q?: string }>;
}) {
  await requireUser();
  await initDb();
  const { devId } = await params;
  const f = await searchParams;

  const conditions = ["al.dev_id = ?"];
  const args: unknown[] = [devId];
  if (f.from) {
    conditions.push("al.io_time >= ?");
    args.push(toDayBound(f.from, "start"));
  }
  if (f.to) {
    conditions.push("al.io_time <= ?");
    args.push(toDayBound(f.to, "end"));
  }
  const q = (f.q ?? "").trim();
  if (q) {
    conditions.push(
      "(al.user_id ILIKE ? OR u.user_name ILIKE ? OR COALESCE(e1.last_name || ' ' || e1.first_name, e.last_name || ' ' || e.first_name) ILIKE ?)"
    );
    args.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  // Persona: por el employee_id ya resuelto, o por cédula = user_id (docs/10 §4.6).
  const rows = await allAsync<Row>(
    `SELECT al.id, al.io_time, al.user_id,
            COALESCE(al.employee_id, e.id) AS employee_id,
            COALESCE(e1.last_name || ', ' || e1.first_name, e.last_name || ', ' || e.first_name) AS employee_name,
            u.user_name AS device_user_name
       FROM attendance_logs al
       LEFT JOIN employee e1 ON e1.id = al.employee_id
       LEFT JOIN employee e ON al.employee_id IS NULL AND regexp_replace(e.national_id, '\\D', '', 'g') = al.user_id
       LEFT JOIN users u ON u.dev_id = al.dev_id AND u.user_id = al.user_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY al.io_time DESC
      LIMIT ${RESULT_LIMIT + 1}`,
    args
  );
  const truncated = rows.length > RESULT_LIMIT;
  const logs = rows.slice(0, RESULT_LIMIT);

  const person = (r: Row) =>
    r.employee_id ? (
      <Link href={`/admin/empleados/${r.employee_id}`} className="text-accent no-underline hover:underline">
        {r.employee_name}
      </Link>
    ) : (
      <span>
        {r.device_user_name || r.user_id} <Tag variant="neutral">sin empleado</Tag>
      </span>
    );

  return (
    <div className="flex max-w-[1100px] flex-col gap-4">
      <DeviceTabs devId={devId} active="marcaciones" />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form method="GET" className="flex flex-wrap items-end gap-2">
          <label className={LABEL}>
            Desde
            <input type="date" name="from" defaultValue={f.from ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Hasta
            <input type="date" name="to" defaultValue={f.to ?? ""} className={INPUT} />
          </label>
          <label className={LABEL}>
            Persona
            <input name="q" defaultValue={q} placeholder="nombre o ID" className={INPUT} />
          </label>
          <Btn type="submit" variant="secondary">
            Filtrar
          </Btn>
        </form>
        <OpButton
          action={syncLogsAction}
          hidden={{ dev_id: devId }}
          title="Traer historial completo"
          description="Pide al equipo TODAS las marcaciones que tiene en memoria. Normalmente no hace falta: llegan solas en el momento, y si el equipo estuvo sin red las reenvía al reconectar."
          variant="icon"
        >
          {Icon.sync}
        </OpButton>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="Sin marcaciones para estos filtros"
          description="Probá con otro rango de fechas, o esperá a que el equipo reporte movimiento."
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <thead>
                <tr>
                  <Th>Fecha y hora</Th>
                  <Th>Persona</Th>
                  <Th>ID en equipo</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((r) => (
                  <Tr key={r.id}>
                    <Td className="font-mono">{formatIoTime(r.io_time)}</Td>
                    <Td>{person(r)}</Td>
                    <Td className="font-mono text-xs">{r.user_id}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </div>
          <MobileList>
            {logs.map((r) => (
              <MobileRow
                key={r.id}
                title={r.employee_name ?? r.device_user_name ?? r.user_id}
                tags={<span className="font-mono text-xs text-text/60">{formatIoTime(r.io_time)}</span>}
                fields={[{ label: "ID", value: r.user_id }]}
              />
            ))}
          </MobileList>
          <p className="m-0 text-xs text-text/70">
            {logs.length} marcación{logs.length === 1 ? "" : "es"}
            {truncated ? ` (mostrando las ${RESULT_LIMIT} más recientes)` : ""} · llegan solas del equipo, no hace
            falta sincronizar para verlas.
          </p>
        </>
      )}
    </div>
  );
}
