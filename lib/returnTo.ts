// "Volver a donde venía" entre vistas de detalle: el link de origen manda su
// propia ruta (con filtros) en ?volver=…, y el destino ofrece regresar a ella.
// Solo se aceptan rutas internas de una empresa — nunca una URL arbitraria.

export const RETURN_PARAM = "volver";

const COMPANY_PATH = /^\/admin\/empresas\/(\d+)(?:\/[a-z-]+)?(?:\?[^#\s]*)?$/;

/** La ruta de regreso a una empresa, si `raw` es una válida. */
export function companyReturn(raw: string | string[] | undefined | null): { path: string; companyId: number } | null {
  if (typeof raw !== "string") return null;
  const m = COMPANY_PATH.exec(raw);
  return m ? { path: raw, companyId: Number(m[1]) } : null;
}

/** `href` con ?volver=<ret> (o tal cual si no hay a dónde volver). */
export function withReturn(href: string, ret: string | null | undefined): string {
  if (!ret) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${RETURN_PARAM}=${encodeURIComponent(ret)}`;
}
