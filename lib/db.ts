import { Pool, types, type CustomTypesConfig } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

// int8 (bigint, OID 20) -> number PARA LOS HELPERS CRUDOS. LOAD-BEARING: cada
// columna `*_at` del protocolo es epoch-millis bigint y cada COUNT(*) vuelve
// como bigint; sin esto la aritmética `Date.now() - row.x` del hot path da NaN
// en silencio y los counts llegan como string. Epoch-millis < 2^53 por ~285
// milenios, así que Number() es lossless. Ver docs/08-data-model.md §1.
//
// OJO: NO usar `types.setTypeParser` global — muta el registro compartido del
// módulo `pg` y rompe al adaptador de Prisma, que necesita recibir los int8
// como STRING para mapearlos a `BigInt` (si no: P2023 "number must be an
// integer ... got '1788226018722.0'"). Por eso el override va como opción
// `types` SOLO del pool de los helpers; Prisma corre sobre su propio pool con
// los parsers por defecto de pg.
const rawPoolTypes: CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: unknown) =>
    oid === 20
      ? (v: string | null) => (v === null ? null : Number(v))
      : (types.getTypeParser as (o: number, f?: unknown) => unknown)(oid, format)) as typeof types.getTypeParser,
};

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL no está definida. Copiá .env.example a .env (ver prisma/README.md)."
  );
}

// Un solo Pool + un solo PrismaClient por proceso, memoizados en globalThis
// para sobrevivir el HMR de Next en dev y los imports repetidos desde procesos
// `tsx` planos (scripts, tests, futuro sync-worker).
const g = globalThis as unknown as {
  __biometricPool?: Pool;
  __biometricPrisma?: PrismaClient;
};

const pool: Pool =
  g.__biometricPool ??
  new Pool({
    connectionString: DATABASE_URL,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    types: rawPoolTypes,
  });
g.__biometricPool = pool;

/**
 * Cliente Prisma para los modelos de dominio (CRUD del admin). Corre sobre su
 * PROPIO pool interno con los type-parsers por defecto de `pg` — así los int8
 * llegan como string y Prisma los mapea a `BigInt` sin romperse. No comparte el
 * pool de los helpers crudos justamente por el override de `rawPoolTypes`.
 */
export const prisma: PrismaClient =
  g.__biometricPrisma ??
  new PrismaClient({
    adapter: new PrismaPg({
      connectionString: DATABASE_URL,
      max: Number(process.env.PRISMA_POOL_MAX ?? process.env.PG_POOL_MAX ?? 10),
    }),
  });
g.__biometricPrisma = prisma;

/**
 * Epoch-millis del reloj del servidor, como fragmento SQL. Reemplaza al
 * `unixepoch('now') * 1000` de SQLite. Se interpola en el string de la query
 * (no toma parámetros) — nunca pasarlo como bind value.
 */
export const NOW_MS = "(extract(epoch from now()) * 1000)::bigint";

/**
 * `?` -> `$1, $2, …`. Todo el código escribe placeholders estilo SQLite (`?`);
 * Postgres necesita posicionales `$n`. Correcto solo mientras ningún string SQL
 * contenga un `?` literal — lo verifica un test unitario sobre las queries reales.
 */
export function toPg(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export interface RunResult {
  /** id devuelto por `RETURNING` (trans_id o id); 0 si la sentencia no lo trae. */
  lastID: number;
  /** filas afectadas por INSERT/UPDATE/DELETE. */
  changes: number;
}

export async function runAsync(
  sql: string,
  params: unknown[] = []
): Promise<RunResult> {
  const res = await pool.query(toPg(sql), params);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  const lastID = row ? Number((row.trans_id ?? row.id ?? 0) as number) : 0;
  return { lastID, changes: res.rowCount ?? 0 };
}

export async function getAsync<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const res = await pool.query(toPg(sql), params);
  return res.rows[0] as T | undefined;
}

export async function allAsync<T = any>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const res = await pool.query(toPg(sql), params);
  return res.rows as T[];
}

/**
 * DDL / limpieza multi-sentencia. Usa el simple-query protocol (sin params),
 * el único camino que admite varias sentencias separadas por `;` en una llamada.
 * El schema ahora lo maneja `prisma migrate`, así que los únicos callers que
 * quedan son tests truncando tablas.
 */
export async function execAsync(sql: string): Promise<void> {
  await pool.query(sql);
}

let initPromise: Promise<void> | null = null;

/**
 * Chequeo de conectividad idempotente. La migración es tarea de
 * `prisma migrate deploy` (prisma/migrations), no de esta función. Memoizado
 * para la vida del proceso; se resetea ante un fallo para que un error
 * transitorio no lo envenene.
 */
export function initDb(): Promise<void> {
  if (!initPromise) {
    initPromise = pool
      .query("SELECT 1")
      .then(() => undefined)
      .catch((err) => {
        initPromise = null;
        throw err;
      });
  }
  return initPromise;
}

export async function closeDb(): Promise<void> {
  initPromise = null;
  g.__biometricPool = undefined;
  g.__biometricPrisma = undefined;
  await prisma.$disconnect().catch(() => {});
  await pool.end().catch(() => {});
}
