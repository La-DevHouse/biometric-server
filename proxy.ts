import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Next 16 renombró `middleware` → `proxy`. Corre en Edge, ANTES del render y
// SIN acceso a la BD (no importar @/lib/db acá).
//
// Chequeo OPTIMISTA de sesión: solo verifica que exista la cookie `session`.
// La validación real (token contra app_session, expiración, usuario activo) la
// hace requireUser() / getSessionUser() en el data layer. Esto cierra el caso
// "no hay cookie" de forma pareja para todas las rutas /admin y /api, incluidas
// las navegaciones soft donde el layout no se re-ejecuta.
export function proxy(request: NextRequest) {
  if (request.cookies.get("session")?.value) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "no autenticado" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

export const config = {
  // El endpoint de los equipos es `/` (app/route.ts), NO está bajo /api — no se toca.
  matcher: ["/admin/:path*", "/api/:path*"],
};
