// Mensaje para la persona a partir de un error de un server action.
//
// Antes cada action devolvía `e.message` tal cual: un error de Prisma llegaba al
// panel como un volcado de 40 líneas (la llamada completa, rutas de .next, tipos)
// que además no cabía en el aviso. Acá: los errores propios (new Error("…") con
// texto en español) pasan igual; los de Prisma / Postgres se traducen y el
// detalle técnico va al log del servidor, no a la pantalla.
import { Prisma } from "@prisma/client";

const GENERIC = "No se pudo guardar por un error interno. Probá de nuevo; si se repite, avisá (el detalle quedó en el log del servidor).";

/** Código y mensaje de Postgres dentro de un error de Prisma (adapter-pg los trae en el texto). */
function postgresError(message: string): { code: string; message: string } | null {
  const m = message.match(/PostgresError \{ code: "([0-9A-Z]{5})", message: "((?:[^"\\]|\\.)*)"/);
  return m ? { code: m[1], message: m[2].replace(/\\"/g, '"') } : null;
}

function fromPostgres(code: string, message: string): string {
  switch (code) {
    case "23505":
      return "Ya existe un registro con esos datos (por ejemplo, el mismo RIF o la misma cédula).";
    case "23503":
      return "No se puede: hay otros registros que dependen de este, o hace referencia a uno que ya no existe.";
    // CHECK y RAISE de nuestros triggers: el texto ya está escrito para la persona.
    case "23514":
    case "P0001":
      return message.charAt(0).toUpperCase() + message.slice(1) + (message.endsWith(".") ? "" : ".");
    default:
      return GENERIC;
  }
}

export function userErrorMessage(e: unknown): string {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    console.error("[action] error de Prisma:", e);
    if (e.code === "P2002") return fromPostgres("23505", "");
    if (e.code === "P2003") return fromPostgres("23503", "");
    if (e.code === "P2025") return "El registro ya no existe (puede que otra persona lo haya borrado). Recargá la página.";
    const pg = postgresError(e.message);
    return pg ? fromPostgres(pg.code, pg.message) : GENERIC;
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError) {
    console.error("[action] error de Prisma:", e);
    const pg = postgresError(e.message);
    return pg ? fromPostgres(pg.code, pg.message) : GENERIC;
  }
  if (
    e instanceof Prisma.PrismaClientValidationError ||
    e instanceof Prisma.PrismaClientInitializationError ||
    e instanceof Prisma.PrismaClientRustPanicError
  ) {
    console.error("[action] error de Prisma:", e);
    return GENERIC;
  }
  // SQL crudo (lib/db, driver pg): trae `code` de 5 caracteres.
  const pgCode = e instanceof Error ? (e as Error & { code?: unknown }).code : undefined;
  if (e instanceof Error && typeof pgCode === "string" && /^[0-9A-Z]{5}$/.test(pgCode)) {
    console.error("[action] error de Postgres:", e);
    return fromPostgres(pgCode, e.message);
  }
  return e instanceof Error ? e.message : String(e);
}
