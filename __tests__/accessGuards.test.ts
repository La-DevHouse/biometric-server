// Cada server action valida el acceso (docs/18). Una acción nueva sin guardia
// haría este test fallar: ocultar el botón no alcanza, cualquiera puede llamarla.
import { test } from "node:test";
import { strict as assert } from "node:assert";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(__dirname, "..");

/** Las que no necesitan perfil: entrar, salir y cambiar la propia contraseña. */
const OPEN = new Set(["app/login/actions.ts:loginAction", "app/login/actions.ts:logoutAction", "app/admin/cuentas/actions.ts:changeMyPasswordAction"]);

/** Formas aceptadas de validar el acceso al principio de una acción. */
const GUARD = /\b(allow\(|adminOnly\(\)|requireAdminPage\()/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /actions\.ts$/.test(f) ? [p] : [];
  });
}

test("toda server action valida el perfil y el alcance", () => {
  const missing: string[] = [];
  let count = 0;
  for (const file of files(join(ROOT, "app"))) {
    const src = readFileSync(file, "utf8");
    if (!src.startsWith('"use server"')) continue;
    const rel = relative(ROOT, file).replace(/\\/g, "/");
    const re = /export async function (\w+)\(/g;
    let m: RegExpExecArray | null;
    const starts: { name: string; at: number }[] = [];
    while ((m = re.exec(src))) starts.push({ name: m[1], at: m.index });
    starts.forEach((s, i) => {
      count++;
      const body = src.slice(s.at, starts[i + 1]?.at ?? src.length);
      if (!OPEN.has(`${rel}:${s.name}`) && !GUARD.test(body)) missing.push(`${rel}: ${s.name}`);
    });
  }
  assert.ok(count > 60, `se esperaban más de 60 acciones, hay ${count}`);
  assert.deepEqual(missing, [], "acciones sin validar acceso");
});
