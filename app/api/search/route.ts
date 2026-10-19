import { NextResponse, type NextRequest } from "next/server";
import { getAccess } from "@/lib/access";
import { globalSearch } from "@/lib/search";

/** GET /api/search?q= — alimenta el buscador global (⌘K, docs/11 S4). */
export async function GET(request: NextRequest) {
  const access = await getAccess();
  if (!access) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  // Cuenta limitada (docs/18): solo encuentra lo de sus empresas.
  const hits = await globalSearch(q, access.companyIds);
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
