// Perfiles de acceso (lib/access.ts, docs/18).
import { test, after } from "node:test";
import { strict as assert } from "node:assert";

{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const { prisma } = require("../lib/db") as typeof import("../lib/db");
const access = require("../lib/access") as typeof import("../lib/access");

const P = `ACC_${Date.now()}_`;
const created = { users: [] as number[], companies: [] as number[] };

after(async () => {
  await prisma.app_user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.$disconnect();
});

async function company(n: number) {
  const c = await prisma.client_company.create({ data: { name: `${P}Co${n}`, sites: { create: { name: "Principal" } } } });
  created.companies.push(c.id);
  return c.id;
}

async function account(role: "admin" | "viewer" | "operator", all: boolean, companyIds: number[] = []) {
  const u = await prisma.app_user.create({
    data: {
      email: `${P}${created.users.length}@test`,
      name: role,
      password_hash: "x",
      role,
      all_companies: all,
      companies: { create: companyIds.map((company_id) => ({ company_id })) },
    },
  });
  created.users.push(u.id);
  return access.accessFor({ id: u.id, email: u.email, name: u.name, role });
}

test("cada perfil: qué puede hacer y con qué empresas", async () => {
  const a = await company(1);
  const b = await company(2);

  const admin = await account("admin", true);
  assert.deepEqual([admin.isAdmin, admin.canEdit, admin.canEditFingerprints, admin.companyIds], [true, true, true, null]);
  assert.ok(access.canSeeCompany(admin, a) && access.canSeeCompany(admin, b));

  const viewer = await account("viewer", true);
  assert.deepEqual([viewer.isAdmin, viewer.canEdit, viewer.canEditFingerprints, viewer.companyIds], [false, false, false, null]);

  const viewerSome = await account("viewer", false, [b]);
  assert.deepEqual(viewerSome.companyIds, [b]);
  assert.equal(access.canSeeCompany(viewerSome, a), false);

  // Socio: edita, solo sus empresas, sin huellas.
  const partner = await account("operator", false, [a]);
  assert.deepEqual([partner.isAdmin, partner.canEdit, partner.canEditFingerprints, partner.companyIds], [false, true, false, [a]]);
  assert.equal(access.canSeeCompany(partner, a), true);
  assert.equal(access.canSeeCompany(partner, b), false);
  assert.deepEqual(access.companyIdWhere(partner), { in: [a] });
  assert.equal(access.companyIdWhere(admin), undefined);

  // Socio sin empresas: no ve ninguna (no "todas").
  const empty = await account("operator", false, []);
  assert.deepEqual(empty.companyIds, []);
});

test("la base no admite un administrador limitado ni un socio con todas las empresas", async () => {
  await assert.rejects(
    prisma.app_user.create({ data: { email: `${P}bad1@test`, name: "x", password_hash: "x", role: "admin", all_companies: false } })
  );
  await assert.rejects(
    prisma.app_user.create({ data: { email: `${P}bad2@test`, name: "x", password_hash: "x", role: "operator", all_companies: true } })
  );
});

test("la guardia: cada tipo de objeto se juzga por su empresa", async () => {
  const a = await company(3);
  const b = await company(4);
  const siteA = (await prisma.site.findFirstOrThrow({ where: { company_id: a } })).id;
  const siteB = (await prisma.site.findFirstOrThrow({ where: { company_id: b } })).id;
  const devA = `${P}devA`;
  const devB = `${P}devB`;
  const devFree = `${P}devFree`;
  await prisma.devices.createMany({ data: [{ dev_id: devA, site_id: siteA }, { dev_id: devB, site_id: siteB }, { dev_id: devFree }] });
  const e = await prisma.employee.create({ data: { national_id: `V-9${Date.now() % 10_000_000}`, first_name: "T", last_name: P } });
  const emA = await prisma.employment.create({ data: { employee_id: e.id, company_id: a, start_date: new Date("2026-01-01T00:00:00Z") } });
  const emB = await prisma.employment.create({ data: { employee_id: e.id, company_id: b, start_date: new Date("2026-01-01T00:00:00Z") } });
  const lonely = await prisma.employee.create({ data: { national_id: `V-8${Date.now() % 10_000_000}`, first_name: "T", last_name: P } });
  const schedB = await prisma.schedule_group.create({ data: { company_id: b, name: `${P}H` } });
  try {
    const partner = await account("operator", false, [a]);
    const reader = await account("viewer", true);
    const admin = await account("admin", true);
    const ok = async (acc: typeof partner, need: Parameters<typeof access.checkAccess>[1]) => (await access.checkAccess(acc, need)).ok;

    // Socio: lo de su empresa sí, lo ajeno no.
    assert.equal(await ok(partner, { edit: true, site: siteA }), true);
    assert.equal(await ok(partner, { edit: true, site: siteB }), false);
    assert.equal(await ok(partner, { edit: true, device: devA }), true);
    assert.equal(await ok(partner, { edit: true, device: devB }), false);
    assert.equal(await ok(partner, { edit: true, device: devFree }), false, "un equipo sin sede es de administradores");
    assert.equal(await ok(partner, { edit: true, employment: emA.id }), true);
    assert.equal(await ok(partner, { edit: true, employment: emB.id }), false, "el contrato con la otra empresa no");
    assert.equal(await ok(partner, { employee: e.id }), true, "la persona sí: tiene contrato con su empresa");
    assert.equal(await ok(partner, { employee: lonely.id }), false);
    assert.equal(await ok(partner, { edit: true, schedule: schedB.id }), false);
    assert.equal(await ok(partner, { edit: true, device: devA, site: siteB }), false, "mover su equipo a una sede ajena");
    assert.equal(await ok(partner, { edit: true, company: 999_999_999 }), false, "lo que no existe tampoco");
    assert.equal(await ok(partner, { fingerprints: true, device: devA }), false, "huellas: solo administradores");
    assert.equal(await ok(partner, { admin: true }), false);

    // Solo lectura: ve todo, no cambia nada.
    assert.equal(await ok(reader, { device: devB }), true);
    assert.equal(await ok(reader, { edit: true, device: devB }), false);

    // Administrador: todo.
    assert.equal(await ok(admin, { fingerprints: true, admin: true, device: devFree }), true);

    // Equipos visibles: los de sus sedes.
    assert.deepEqual(await access.scopedDevIds(partner), [devA]);
    assert.equal(await access.scopedDevIds(reader), null);

    // Buscador global: solo lo suyo.
    const { globalSearch } = require("../lib/search") as typeof import("../lib/search");
    const hits = await globalSearch(P, [a]);
    const kinds = (k: string) => hits.filter((h) => h.kind === k).map((h) => h.id);
    assert.deepEqual(kinds("empresa"), [String(a)]);
    assert.deepEqual(kinds("equipo"), [devA]);
    assert.deepEqual(kinds("empleado"), [String(e.id)]);
    assert.equal(hits.some((h) => h.subtitle?.includes(`${P}Co4`)), false, "no muestra la empresa ajena de la persona");
    assert.ok((await globalSearch(P, null)).some((h) => h.id === devFree));
  } finally {
    await prisma.employment.deleteMany({ where: { employee_id: { in: [e.id, lonely.id] } } });
    await prisma.employee.deleteMany({ where: { id: { in: [e.id, lonely.id] } } });
    await prisma.devices.deleteMany({ where: { dev_id: { in: [devA, devB, devFree] } } });
    await prisma.schedule_group.deleteMany({ where: { id: schedB.id } });
  }
});
