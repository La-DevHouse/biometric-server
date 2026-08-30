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

async function main() {
  const admin = new Client({ connectionString: swapDb(base, "postgres") });
  try {
    await admin.connect();
  } catch (err) {
    console.error(
      `[test-db] no se pudo conectar a Postgres (${swapDb(base, "postgres")}).\n` +
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
  console.error(err);
  process.exit(1);
});
