// Sede del contrato (lib/employmentSite): informativa; sola con una sede, obligatoria con varias.
import { test, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";

{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const es = require("../lib/employmentSite") as typeof import("../lib/employmentSite");
const { prisma } = db;

const P = `ESITE_${Date.now()}_`;
const SEED = String(Date.now() % 1_000_000).padStart(6, "0");
let seq = 0;
const created = { companies: [] as number[], employees: [] as number[] };

after(async () => {
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.$disconnect();
});

async function company(...sites: string[]) {
  const c = await prisma.client_company.create({
    data: { name: P + sites.join("+"), tax_id: "J-00000000-0", sites: { create: sites.map((name) => ({ name })) } },
    include: { sites: { orderBy: { id: "asc" } } },
  });
  created.companies.push(c.id);
  return { id: c.id, sites: c.sites.map((s) => s.id) };
}

test("una sola sede: se asigna sola", async () => {
  const c = await company("Única");
  assert.deepEqual(await es.resolveContractSite(c.id, null), { siteId: c.sites[0] });
  assert.equal(await es.onlySiteOf(c.id), c.sites[0]);
});

test("varias sedes: es obligatoria, y tiene que ser de la empresa", async () => {
  const c = await company("Norte", "Sur");
  const other = await company("Ajena");
  assert.match((await es.resolveContractSite(c.id, null) as { error: string }).error, /varias sedes/);
  assert.deepEqual(await es.resolveContractSite(c.id, c.sites[1]), { siteId: c.sites[1] });
  assert.ok("error" in (await es.resolveContractSite(c.id, other.sites[0])), "sede de otra empresa");
  assert.equal(await es.onlySiteOf(c.id), null, "registro rápido / importación: sin sede");
});

test("sede desactivada: no se elige para un contrato nuevo, pero el que ya la tenía la conserva", async () => {
  const c = await company("Norte", "Sur", "Vieja");
  await prisma.site.update({ where: { id: c.sites[2] }, data: { status: "inactive" } });
  assert.ok("error" in (await es.resolveContractSite(c.id, c.sites[2])));
  assert.deepEqual(await es.resolveContractSite(c.id, c.sites[2], c.sites[2]), { siteId: c.sites[2] });
  // Con una sola sede ACTIVA (las otras desactivadas) vuelve a asignarse sola.
  await prisma.site.update({ where: { id: c.sites[1] }, data: { status: "inactive" } });
  assert.deepEqual(await es.resolveContractSite(c.id, null), { siteId: c.sites[0] });
});

test("migración: los contratos de empresas con una sola sede quedan con esa sede; con varias, sin sede", async () => {
  const one = await company("Única");
  const two = await company("Norte", "Sur");
  const person = await prisma.employee.create({ data: { national_id: `V-6${++seq}${SEED}`, first_name: "P", last_name: P } });
  created.employees.push(person.id);
  const start = new Date("2026-01-01T00:00:00Z");
  const a = await prisma.employment.create({ data: { employee_id: person.id, company_id: one.id, start_date: start } });
  const b = await prisma.employment.create({ data: { employee_id: person.id, company_id: two.id, start_date: start } });

  const sql = readFileSync(join(__dirname, "..", "prisma", "migrations", "20261116180000_employment_site", "migration.sql"), "utf8");
  const backfill = sql.slice(sql.indexOf('UPDATE "employment"'));
  await db.execAsync(backfill);

  assert.equal((await prisma.employment.findUnique({ where: { id: a.id } }))?.site_id, one.sites[0]);
  assert.equal((await prisma.employment.findUnique({ where: { id: b.id } }))?.site_id, null);
});
