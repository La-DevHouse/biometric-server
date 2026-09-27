import { prisma } from "@/lib/db";

/**
 * Chequeo de la base para los healthchecks de Coolify (app y worker): un
 * `SELECT 1` con tope de tiempo — una base colgada no puede dejar colgado al
 * healthcheck (Coolify lo daría por caído recién en su propio timeout).
 */
export async function pingDb(timeoutMs = 2000): Promise<{ ok: true; ms: number } | { ok: false; error: string }> {
  const t0 = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sin respuesta en ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
