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
