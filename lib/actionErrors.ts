/**
 * Errores que nunca llegan a devolver el `{ ok: false, error }` normal de un
 * Server Action invocado a mano (ej. 413 "Body exceeded 1 MB limit" — Next
 * rechaza el request antes de que la función del action corra) llegan como
 * excepción del fetch, no como resultado. Sin atraparla aparte queda
 * silenciosa: el catch nunca corre, el estado de "cargando" se queda pegado y
 * la persona no ve nada. Ver next.config.ts (serverActions.bodySizeLimit).
 */
export function describeActionError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("Body exceeded") || message.includes("413")) {
    return "El archivo es muy pesado para subir. Probá con uno más liviano o sacá la foto de nuevo.";
  }
  return "No se pudo procesar el archivo. Probá de nuevo.";
}
