import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { globalSearch } from "@/lib/search";

/** GET /api/search?q= — alimenta el buscador global (⌘K, docs/11 S4). */
export async function GET(request: NextRequest) {
  if (!(await getSessionUser())) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const hits = await globalSearch(q);
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
