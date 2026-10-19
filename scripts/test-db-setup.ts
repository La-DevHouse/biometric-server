// `pretest` de npm: garantiza que exista una base Postgres separada para los
// tests (biometric_test), con las migraciones aplicadas. No toca la base de
// desarrollo. Si `TEST_DATABASE_URL` está seteada, se usa esa tal cual.
//
// Requiere que el Postgres local esté corriendo (`docker compose up -d db`).

import { execSync } from "node:child_process";
import { Client } from "pg";

const base =
  process.env.DATABASE_URL ??
  "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";

const swapDb = (url: string, name: string) =>
  url.replace(/(\/\/[^/]+\/)[^/?]+/, `$1${name}`);

const testUrl = process.env.TEST_DATABASE_URL ?? swapDb(base, "biometric_test");
const testDbName = new URL(testUrl).pathname.slice(1);

/** El Postgres de desarrollo de docker-compose.yml (puerto 55432). */
/** Para mensajes: la URL sin contraseña (nunca imprimir credenciales). */
const redact = (url: string) => url.replace(/(\/\/[^:/@]+:)[^@]*@/g, "$1***@");

const isDockerDev = (url: string) => /@(localhost|127\.0\.0\.1):55432\//.test(url);
const sameDb = (a: string, b: string) => {
  const ua = new URL(a);
  const ub = new URL(b);
  return ua.host === ub.host && ua.pathname === ub.pathname;
};

/**
 * Candado: los tests crean, migran y llenan una base. Si DATABASE_URL apunta a
 * otra cosa que el Postgres de Docker (p. ej. producción por un túnel SSH, que
 * también es "localhost"), derivar la base de tests de ahí la crearía en ESE
 * servidor. Entonces: o se dice explícitamente cuál es la de tests, o no se corre.
 */
function guard() {
  if (process.env.TEST_DATABASE_URL) {
    if (sameDb(process.env.TEST_DATABASE_URL, base)) {
      throw new Error("[test-db] TEST_DATABASE_URL es la misma base que DATABASE_URL. Los tests la borrarían/llenarían: use una base de pruebas aparte.");
    }
    return;
  }
  if (!isDockerDev(base)) {
    throw new Error(
      "[test-db] DATABASE_URL no es el Postgres local de Docker (puerto 55432) — puede ser producción.\n" +
        "Para correr los tests, defina TEST_DATABASE_URL con una base de pruebas que NO sea producción\n" +
        '(p. ej. TEST_DATABASE_URL="postgresql://biometric:biometric@localhost:55432/biometric_test?schema=public").'
    );
  }
}

async function main() {
  guard();
  // La base de tests se crea en el servidor de la base de TESTS, nunca en el de
  // DATABASE_URL: si ese es producción (túnel), crearía ahí una base vacía.
  const adminUrl = swapDb(testUrl, "postgres");
  const admin = new Client({ connectionString: adminUrl });
  try {
    await admin.connect();
  } catch (err) {
    console.error(
      `[test-db] no se pudo conectar a Postgres (${redact(adminUrl)}).\n` +
        `¿Está corriendo? -> docker compose up -d db`
    );
    throw err;
  }
  const { rowCount } = await admin.query(
    "SELECT 1 FROM pg_database WHERE datname = $1",
    [testDbName]
  );
  if (!rowCount) {
    await admin.query(`CREATE DATABASE "${testDbName}"`);
    console.log(`[test-db] creada ${testDbName}`);
  }
  await admin.end();

  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
  console.log(`[test-db] ${testDbName} migrada y lista`);
}

main().catch((err) => {
  // El error de pg puede traer la cadena de conexión: solo el mensaje, sin credenciales.
  console.error(redact(err instanceof Error ? err.message : String(err)));
  process.exit(1);
});
