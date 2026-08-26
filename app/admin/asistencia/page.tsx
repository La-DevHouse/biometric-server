import { Suspense } from "react";
import { allAsync, initDb } from "@/lib/db";
import { AttendanceFilters } from "@/components/admin/AttendanceFilters";
import { Table, Th, Td, Tr } from "@/components/ui/Table";
import { DisabledBtn } from "@/components/ui/Btn";
import { EmptyState } from "@/components/ui/EmptyState";
import { OpButton } from "@/components/admin/OpButton";
import { ClearLogsDialog } from "@/components/admin/ClearLogsDialog";
import { syncLogsAction } from "@/app/admin/actions";
import { formatVerifyMode } from "@/lib/verifyMode";

export const revalidate = 3;

const RESULT_LIMIT = 200;
const PICK_DEVICE = "Selecciona un dispositivo específico primero";

interface AttendanceRow {
  id: number;
  dev_id: string;
  user_id: string;
  verify_mode: string | null;
  io_time: string | null;
  has_image: number;
  display_name: string;
  device_name: string;
}

function toDayBound(dateInput: string, edge: "start" | "end"): string {
  const digits = dateInput.replaceAll("-", "");
  return digits + (edge === "start" ? "000000" : "235959");
}

function formatIoTime(ioTime: string | null): string {
  if (!ioTime || ioTime.length < 14) return ioTime || "—";
  const y = ioTime.slice(0, 4);
  const mo = ioTime.slice(4, 6);
  const d = ioTime.slice(6, 8);
  const h = ioTime.slice(8, 10);
  const mi = ioTime.slice(10, 12);
  const s = ioTime.slice(12, 14);
  return `${d}/${mo}/${y} ${h}:${mi}:${s}`;
}

async function getData(filters: { dev?: string; user?: string; from?: string; to?: string }) {
  await initDb();

  const devices = await allAsync<{ dev_id: string; fk_name: string | null }>(
    `SELECT dev_id, fk_name FROM devices ORDER BY dev_id`
  );

  const users = await allAsync<{ dev_id: string; user_id: string; user_name: string | null }>(
    `SELECT dev_id, user_id, user_name FROM users ORDER BY dev_id, CAST(user_id AS INTEGER), user_id`
  );

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.dev) {
    conditions.push("al.dev_id = ?");
    params.push(filters.dev);
    if (filters.user) {
      conditions.push("al.user_id = ?");
      params.push(filters.user);
    }
  }
  if (filters.from) {
    conditions.push("al.io_time >= ?");
    params.push(toDayBound(filters.from, "start"));
  }
  if (filters.to) {
    conditions.push("al.io_time <= ?");
    params.push(toDayBound(filters.to, "end"));
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const logs = await allAsync<AttendanceRow>(
    `SELECT al.id, al.dev_id, al.user_id, al.verify_mode, al.io_time,
            (al.log_image IS NOT NULL) AS has_image,
            COALESCE(u.user_name, al.user_id) AS display_name,
            COALESCE(d.fk_name, al.dev_id) AS device_name
       FROM attendance_logs al
       LEFT JOIN devices d ON d.dev_id = al.dev_id
       LEFT JOIN users u ON u.dev_id = al.dev_id AND u.user_id = al.user_id
       ${where}
      ORDER BY al.io_time DESC
      LIMIT ${RESULT_LIMIT + 1}`,
    params
  );

  return { devices, users, logs: logs.slice(0, RESULT_LIMIT), truncated: logs.length > RESULT_LIMIT };
}

export default async function AsistenciaPage({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string; user?: string; from?: string; to?: string }>;
}) {
  const filters = await searchParams;
  const { devices, users, logs, truncated } = await getData(filters);

  return (
    <div className="flex flex-col gap-4 max-w-[1200px]">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <Suspense
          fallback={<div className="min-h-9 w-full max-w-md bg-surface border border-divider" />}
        >
          <AttendanceFilters
            devices={devices.map((d) => ({ dev_id: d.dev_id, label: d.fk_name || d.dev_id }))}
            users={users.map((u) => ({
              dev_id: u.dev_id,
              user_id: u.user_id,
              label: u.user_name || u.user_id,
            }))}
          />
        </Suspense>
        <div className="flex gap-2">
          {filters.dev ? (
            <>
              <OpButton action={syncLogsAction} hidden={{ dev_id: filters.dev }}>
                Sincronizar historial completo
              </OpButton>
              <ClearLogsDialog devId={filters.dev} />
            </>
          ) : (
            <>
              <DisabledBtn variant="secondary" title={PICK_DEVICE}>
                Sincronizar historial completo
              </DisabledBtn>
              <DisabledBtn variant="secondary" title={PICK_DEVICE}>
                Borrar memoria del equipo…
              </DisabledBtn>
            </>
          )}
        </div>
      </div>

      {logs.length === 0 ? (
        <EmptyState
          title="Sin marcaciones para estos filtros"
          description="Prueba con otro rango de fechas o dispositivo, o espera a que el equipo reporte movimiento."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Fecha y hora</Th>
                <Th>Dispositivo</Th>
                <Th>Usuario</Th>
                <Th>Verificación</Th>
                <Th>Imagen</Th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <Tr key={log.id}>
                  <Td className="font-mono">{formatIoTime(log.io_time)}</Td>
                  <Td>{log.device_name}</Td>
                  <Td>{log.display_name}</Td>
                  <Td>{formatVerifyMode(log.verify_mode)}</Td>
                  <Td>{log.has_image ? "Sí" : <span className="text-text/50">—</span>}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <p className="text-xs text-text/50">
            {logs.length} marcación{logs.length === 1 ? "" : "es"}
            {truncated ? ` (mostrando las ${RESULT_LIMIT} más recientes)` : ""} · datos locales, al
            día — llegan solas del equipo, no hace falta sincronizar para verlas.
          </p>
        </>
      )}
    </div>
  );
}
