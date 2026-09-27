import { test, after } from "node:test";
import { strict as assert } from "node:assert";

// Mismo arreglo que scope.test.ts: apuntar a la base de tests ANTES del require().
{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const search = require("../lib/search") as typeof import("../lib/search");
const { prisma } = db;

// Un token raro por corrida para que la búsqueda solo encuentre lo de este test.
const TOKEN = `zq${Date.now().toString(36)}`;
const DIGITS = String(Date.now()).slice(-7);
const created = { companies: [] as number[], employees: [] as number[], devices: [] as string[] };

after(async () => {
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: created.devices } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.$disconnect();
  await db.closeDb();
});

test("globalSearch: acentos, cédula por dígitos, contexto y tipos", async () => {
  const c = await prisma.client_company.create({
    data: { name: `Farmacía ${TOKEN}`, tax_id: `J-${DIGITS}-1`, sites: { create: { name: `Sede Álamo ${TOKEN}` } } },
    include: { sites: true },
  });
  created.companies.push(c.id);
  const e = await prisma.employee.create({
    data: { national_id: `V-9${DIGITS}`, first_name: "José", last_name: `Pérez ${TOKEN}` },
  });
  created.employees.push(e.id);
  await prisma.employment.create({
    data: { employee_id: e.id, company_id: c.id, start_date: new Date("2026-01-01T00:00:00Z") },
  });
  const dev = `DEV${TOKEN}`;
  await prisma.devices.create({ data: { dev_id: dev, fk_name: `Caja ${TOKEN}`, site_id: c.sites[0].id } });
  created.devices.push(dev);

  // Sin acentos encuentra con acentos (y al revés), en empresa, sede y empleado.
  const hits = await search.globalSearch(TOKEN.toUpperCase());
  const kinds = new Set(hits.map((h) => h.kind));
  for (const k of ["empresa", "sede", "empleado", "equipo"] as const) assert.ok(kinds.has(k), `falta ${k}`);

  assert.ok((await search.globalSearch(`farmacia ${TOKEN}`)).some((h) => h.kind === "empresa" && h.id === String(c.id)));
  assert.ok((await search.globalSearch(`alamo ${TOKEN}`)).some((h) => h.kind === "sede"));
  assert.ok((await search.globalSearch(`jose perez ${TOKEN}`)).some((h) => h.kind === "empleado"));

  // Cédula por dígitos (sin el prefijo V-) y RIF por dígitos.
  const byCedula = await search.globalSearch(`9${DIGITS}`);
  const emp = byCedula.find((h) => h.kind === "empleado" && h.id === String(e.id));
  assert.ok(emp, "encuentra por los dígitos de la cédula");
  assert.equal(emp!.href, `/admin/empleados/${e.id}`);
  assert.match(emp!.subtitle ?? "", new RegExp(`V-9${DIGITS}.*Farmacía`), "contexto: cédula · empresa");
  assert.ok((await search.globalSearch(DIGITS)).some((h) => h.kind === "empresa" && h.id === String(c.id)));

  // Equipo: contexto con empresa · sede; link al detalle.
  const eq = hits.find((h) => h.kind === "equipo")!;
  assert.equal(eq.href, `/admin/dispositivos/${dev}`);
  assert.match(eq.subtitle ?? "", /Farmacía .* · Sede Álamo/);

  // Menos de 2 caracteres: nada; comodines de LIKE escapados.
  assert.deepEqual(await search.globalSearch("a"), []);
  assert.deepEqual(await search.globalSearch(`%_${TOKEN}`), []);
});
