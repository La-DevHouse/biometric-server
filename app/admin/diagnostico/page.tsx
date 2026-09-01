import { Suspense } from "react";
import { requireUser } from "@/lib/auth";
import { allAsync, initDb } from "@/lib/db";
import { DeviceSelect } from "@/components/ui/DeviceSelect";
import { DiagnosticoCommandForm } from "@/components/admin/DiagnosticoCommandForm";
import { Card, CardKicker, CardTitle } from "@/components/ui/Card";
import { Tag } from "@/components/ui/Tag";
import { EmptyState } from "@/components/ui/EmptyState";

// force-dynamic: la página pega a Postgres en un Server Component; con `revalidate`
// Next intenta prerenderizarla en `next build`, lo que exige la BD accesible en
// build time (falla en Coolify: el hostname interno no resuelve en el builder).
export const dynamic = "force-dynamic";

interface CommandRow {
  trans_id: number;
  dev_id: string;
  cmd_code: string;
  cmd_param: string | null;
  status: string;
  result_json: string | null;
  cmd_return_code: string | null;
  op_id: number | null;
  created_at: number;
  updated_at: number;
}

interface TrafficRow {
  id: number;
  direction: "in" | "out";
  dev_id: string | null;
  request_code: string | null;
  headers_json: string | null;
  body_preview: string | null;
  body_size: number | null;
  binary_size: number | null;
  created_at: number;
}

async function getData(devId: string | undefined) {
  await initDb();

  const devices = await allAsync<{ dev_id: string; fk_name: string | null }>(
    `SELECT dev_id, fk_name FROM devices ORDER BY dev_id`
  );

  const commandParams: unknown[] = [];
  const commandWhere = devId ? "WHERE dev_id = ?" : "";
  if (devId) commandParams.push(devId);

  const commands = await allAsync<CommandRow>(
    `SELECT trans_id, dev_id, cmd_code, cmd_param, status, result_json, cmd_return_code, op_id,
            created_at, updated_at
       FROM commands
       ${commandWhere}
      ORDER BY created_at DESC
      LIMIT 50`,
    commandParams
  );

  const trafficParams: unknown[] = [];
  const trafficWhere = devId ? "WHERE dev_id = ?" : "";
  if (devId) trafficParams.push(devId);

  const traffic = await allAsync<TrafficRow>(
    `SELECT id, direction, dev_id, request_code, headers_json, body_preview, body_size,
            binary_size, created_at
       FROM raw_traffic
       ${trafficWhere}
      ORDER BY created_at DESC
      LIMIT 100`,
    trafficParams
  );

  return { devices, commands, traffic };
}

function statusTag(status: string) {
  if (status === "RESULT") return <Tag variant="accent">RESULT</Tag>;
  if (status === "RUN") return <Tag variant="accent2">RUN</Tag>;
  if (status === "ERROR") return <Tag variant="outline">ERROR</Tag>;
  return <Tag variant="neutral">{status}</Tag>;
}

export default async function DiagnosticoPage({
  searchParams,
}: {
  searchParams: Promise<{ dev?: string }>;
}) {
  await requireUser();
  const { dev } = await searchParams;
  const { devices, commands, traffic } = await getData(dev);
  const deviceOptions = devices.map((d) => ({ dev_id: d.dev_id, label: d.fk_name || d.dev_id }));

  return (
    <div className="flex flex-col gap-6 max-w-[1200px]">
      <p className="text-xs text-text/50 max-w-lg">
        Herramienta de bajo nivel: encola comandos crudos del protocolo y observa la cola y el
        tráfico entrante/saliente. Es lo que permitió descubrir los quirks del firmware — nada
        aquí pasa por la capa de operaciones de negocio.
      </p>

      <Card>
        <CardKicker>Comando manual</CardKicker>
        <CardTitle>Encolar comando</CardTitle>
        <DiagnosticoCommandForm devices={deviceOptions} />
      </Card>

      <div className="flex items-center gap-3">
        <Suspense fallback={<div className="min-h-9 w-40 bg-surface border border-divider" />}>
          <DeviceSelect devices={deviceOptions} allowAll />
        </Suspense>
        <span className="text-xs text-text/50">filtra la cola y el tráfico de abajo</span>
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="font-heading text-lg m-0">Cola de comandos</h4>
        {commands.length === 0 ? (
          <EmptyState title="Sin comandos" description="Todavía no se encoló ningún comando." />
        ) : (
          <div className="flex flex-col border border-divider divide-y divide-divider">
            {commands.map((cmd) => {
              const params = cmd.cmd_param ? JSON.parse(cmd.cmd_param) : null;
              const result = cmd.result_json ? JSON.parse(cmd.result_json) : null;
              return (
                <details key={cmd.trans_id} className="group">
                  <summary className="p-2.5 cursor-pointer hover:bg-text/4 flex items-center gap-3 flex-wrap list-none">
                    <span className="font-mono text-xs text-text/50 w-12">#{cmd.trans_id}</span>
                    <span className="font-mono text-xs">{cmd.dev_id}</span>
                    <span className="font-heading text-sm">{cmd.cmd_code}</span>
                    {statusTag(cmd.status)}
                    {cmd.op_id && <Tag variant="outline">op #{cmd.op_id}</Tag>}
                    <span className="ml-auto text-xs text-text/50">
                      {new Date(cmd.updated_at).toLocaleString()}
                    </span>
                  </summary>
                  <div className="p-3 pt-0 flex flex-col gap-2 text-xs">
                    {params && (
                      <div>
                        <p className="text-text/50 m-0 mb-1">Parámetros enviados</p>
                        <pre className="bg-surface border border-divider p-2 overflow-x-auto whitespace-pre-wrap m-0">
                          {JSON.stringify(params, null, 2)}
                        </pre>
                      </div>
                    )}
                    {result && (
                      <div>
                        <p className="text-text/50 m-0 mb-1">Respuesta del equipo</p>
                        <pre className="bg-surface border border-divider p-2 overflow-x-auto whitespace-pre-wrap m-0">
                          {JSON.stringify(result, null, 2)}
                        </pre>
                      </div>
                    )}
                    {cmd.cmd_return_code && (
                      <p className="m-0">
                        Código de retorno: <span className="font-mono">{cmd.cmd_return_code}</span>
                      </p>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h4 className="font-heading text-lg m-0">Tráfico crudo</h4>
        {traffic.length === 0 ? (
          <EmptyState title="Sin tráfico" description="Todavía no se registró tráfico HTTP." />
        ) : (
          <div className="flex flex-col border border-divider divide-y divide-divider max-h-[70vh] overflow-y-auto">
            {traffic.map((item) => {
              const headers = item.headers_json ? JSON.parse(item.headers_json) : {};
              return (
                <div key={item.id} className="p-2.5 flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Tag variant={item.direction === "in" ? "accent2" : "accent"}>
                      {item.direction === "in" ? "← IN" : "→ OUT"}
                    </Tag>
                    <span className="font-mono">{item.request_code || "—"}</span>
                    {item.dev_id && <span className="text-text/50">{item.dev_id}</span>}
                    <span className="ml-auto text-text/50">
                      {new Date(item.created_at).toLocaleTimeString()}
                    </span>
                  </div>
                  {Object.keys(headers).length > 0 && (
                    <div className="bg-surface border border-divider p-2 font-mono">
                      {Object.entries(headers).map(([key, value]) => (
                        <div key={key}>
                          <span className="text-text/50">{key}:</span> {String(value)}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="m-0 text-text/50">
                    {item.body_size ?? 0} bytes
                    {item.binary_size ? ` (${item.binary_size} binarios)` : ""}
                  </p>
                  {item.body_preview && (
                    <details>
                      <summary className="cursor-pointer text-accent">
                        Vista previa ({item.body_preview.length} caracteres)
                      </summary>
                      <pre className="mt-1 bg-surface border border-divider p-2 overflow-x-auto whitespace-pre-wrap">
                        {item.body_preview.slice(0, 500)}
                        {item.body_preview.length > 500 ? "…" : ""}
                      </pre>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
