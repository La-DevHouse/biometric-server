import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { listTrackedOperations } from "@/lib/operations";

/**
 * GET /api/operations?ids=1,2,3 — alimenta el panel global "Procesando"
 * (components/admin/OperationsTracker): todas las operaciones activas más las
 * `ids` que el cliente ya venía siguiendo (para ver su resultado final), cada
 * una con sus pasos. Ver lib/operations → listTrackedOperations.
 */
export async function GET(request: NextRequest) {
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, 100);
  const ops = await listTrackedOperations(ids);
  return NextResponse.json({ ops });
}
