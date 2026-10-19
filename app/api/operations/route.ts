import { NextResponse, type NextRequest } from "next/server";
import { getAccess, scopedDevIds } from "@/lib/access";
import { listTrackedOperations } from "@/lib/operations";

/**
 * GET /api/operations?ids=1,2,3 — alimenta el panel global "Procesando"
 * (components/admin/OperationsTracker): todas las operaciones activas más las
 * `ids` que el cliente ya venía siguiendo (para ver su resultado final), cada
 * una con sus pasos. Ver lib/operations → listTrackedOperations.
 */
export async function GET(request: NextRequest) {
  const access = await getAccess();
  if (!access) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 100);
  const devIds = await scopedDevIds(access);
  // Cuenta limitada (docs/18): solo las operaciones de sus equipos.
  const ops = (await listTrackedOperations(ids)).filter((o) => devIds === null || devIds.includes(o.dev_id));
  return NextResponse.json({ ops });
}
