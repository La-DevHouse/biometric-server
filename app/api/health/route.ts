import { NextResponse } from "next/server";
import { pingDb } from "@/lib/health";

// Nunca cacheado: cada llamada tiene que mirar el estado real.
export const dynamic = "force-dynamic";

/**
 * GET /api/health — healthcheck de Coolify para la app (docs/06).
 * 200 si el proceso responde y la base contesta; 503 si la base no.
 * Público a propósito (proxy.ts lo exceptúa del chequeo de sesión) y sin datos
 * sensibles: solo estado y latencia.
 */
export async function GET() {
  const db = await pingDb();
  const body = {
    status: db.ok ? "ok" : "error",
    service: "app",
    db: db.ok ? { ok: true, ms: db.ms } : { ok: false, error: db.error },
    uptimeS: Math.round(process.uptime()),
  };
  return NextResponse.json(body, {
    status: db.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
