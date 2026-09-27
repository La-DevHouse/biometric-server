// Healthcheck HTTP del worker para Coolify (docs/06). El worker no tiene
// servidor web propio: esto es lo mínimo — un `GET /health` en su propio
// puerto (WORKER_HEALTH_PORT, 3001), sin dominio ni exposición pública.
//
// Sano = el proceso está vivo, en un estado esperado y la base contesta.
// "Esperando migraciones" cuenta como SANO a propósito: es el estado normal
// mientras la app nueva migra durante un deploy (Coolify no ordena deploys
// entre servicios); marcarlo caído haría que Coolify descarte el deploy.
import { createServer, type Server } from "node:http";
import { pingDb } from "@/lib/health";

export type WorkerState = "waiting_migrations" | "starting" | "running" | "stopping";

let state: WorkerState = "starting";
let lastError: { at: string; message: string } | null = null;
const startedAt = Date.now();

export function setWorkerState(s: WorkerState): void {
  state = s;
}

/** Registra el último error de pg-boss (se muestra en /health; no lo marca caído por sí solo). */
export function reportWorkerError(err: unknown): void {
  lastError = { at: new Date().toISOString(), message: err instanceof Error ? err.message : String(err) };
}

export function startHealthServer(): Server | null {
  const port = Number(process.env.WORKER_HEALTH_PORT ?? 3001);
  if (!Number.isInteger(port) || port <= 0) return null; // WORKER_HEALTH_PORT=0 lo apaga

  const server = createServer(async (req, res) => {
    if (req.method !== "GET" || (req.url !== "/health" && req.url !== "/")) {
      res.writeHead(404).end();
      return;
    }
    const db = await pingDb();
    const healthy = db.ok && state !== "stopping";
    res.writeHead(healthy ? 200 : 503, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(
      JSON.stringify({
        status: healthy ? "ok" : "error",
        service: "worker",
        state,
        db: db.ok ? { ok: true, ms: db.ms } : { ok: false, error: db.error },
        lastError,
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
      })
    );
  });
  server.on("error", (err) => console.error("[worker] healthcheck:", err));
  server.listen(port, "0.0.0.0", () => console.log(`[worker] healthcheck en :${port}/health`));
  return server;
}
