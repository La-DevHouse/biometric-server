import { test, after } from "node:test";
import { strict as assert } from "node:assert";

// Mismo arreglo que operations.test.ts: lib/db lee DATABASE_URL al evaluarse,
// así que se apunta a la base de tests ANTES de un require() (no se hoistea).
{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const scope = require("../lib/scope") as typeof import("../lib/scope");
const impact = require("../lib/sync/impact") as typeof import("../lib/sync/impact");
const { prisma } = db;

// Todo lo que crea este archivo lleva este prefijo y se borra al final, para no
// dejar contratos que rompan el `DELETE FROM employee` de operations.test.ts.
const P = `SCOPE_${Date.now()}_`;
const created = { groups: [] as number[], companies: [] as number[], employees: [] as number[], devices: [] as string[] };

async function group(name: string, shared: boolean, status: "active" | "inactive" = "active") {
  const g = await prisma.company_group.create({ data: { name: P + name, shared_employees: shared, status } });
  created.groups.push(g.id);
  return g.id;
}

/** Empresa con su sede (obligatoria, docs/10 R2); devuelve empresa + sede. */
async function company(name: string, groupId: number | null = null) {
  const c = await prisma.client_company.create({
    data: { name: P + name, tax_id: "J-00000000-0", group_id: groupId, sites: { create: { name: "Principal" } } },
    include: { sites: true },
  });
  created.companies.push(c.id);
  return { id: c.id, siteId: c.sites[0].id };
}

async function device(devId: string, siteId: number | null) {
  const id = P + devId;
  await prisma.devices.create({ data: { dev_id: id, site_id: siteId } });
  created.devices.push(id);
  return id;
}

async function employee(cedula: string) {
  const e = await prisma.employee.create({
    data: { national_id: `V${cedula}`, first_name: "Test", last_name: P },
  });
  created.employees.push(e.id);
  return e.id;
}

const day = (offset: number) => {
  const d = new Date();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + offset));
};

async function contract(employeeId: number, companyId: number, opts: { start?: number; end?: number; status?: "active" | "inactive" } = {}) {
  await prisma.employment.create({
    data: {
      employee_id: employeeId,
      company_id: companyId,
      start_date: day(opts.start ?? -30),
      end_date: opts.end === undefined ? null : day(opts.end),
      status: opts.status ?? "active",
    },
  });
}

const sorted = (xs: string[]) => [...xs].sort();

after(async () => {
  await prisma.employment.deleteMany({ where: { employee_id: { in: created.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: created.employees } } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: created.devices } } });
  // borrar la empresa cascadea sus sedes; el trigger diferido no molesta porque la empresa ya no existe
  await prisma.client_company.deleteMany({ where: { id: { in: created.companies } } });
  await prisma.company_group.deleteMany({ where: { id: { in: created.groups } } });
  await prisma.$disconnect();
});

// --- Alcance (docs/10 §4.1, R6) ---

test("scope - empresa sin grupo: solo los equipos de sus propias sedes", async () => {
  const a = await company("A");
  const b = await company("B");
  const da = await device("A1", a.siteId);
  await device("B1", b.siteId);
  const emp = await employee("91000001");
  await contract(emp, a.id);

  assert.deepEqual(await scope.applicableDevices(emp), [da]);
});

test("scope - grupo que comparte empleados: equipos de todas las empresas del grupo", async () => {
  const g = await group("G1", true);
  const a = await company("GA", g);
  const b = await company("GB", g);
  const other = await company("OTRA");
  const da = await device("GA1", a.siteId);
  const db2 = await device("GB1", b.siteId);
  await device("OT1", other.siteId);
  const emp = await employee("91000002");
  await contract(emp, a.id); // un solo contrato, en A

  assert.deepEqual(sorted(await scope.applicableDevices(emp)), sorted([da, db2]));
});

test("scope - grupo que NO comparte: solo la empresa del contrato, aunque el grupo exista", async () => {
  const g = await group("G2", false);
  const a = await company("NA", g);
  const b = await company("NB", g);
  const da = await device("NA1", a.siteId);
  await device("NB1", b.siteId);
  const emp = await employee("91000003");
  await contract(emp, a.id);

  assert.deepEqual(await scope.applicableDevices(emp), [da]);
});

test("scope - grupo inactivo no extiende el alcance", async () => {
  const g = await group("G3", true, "inactive");
  const a = await company("IA", g);
  const b = await company("IB", g);
  const da = await device("IA1", a.siteId);
  await device("IB1", b.siteId);
  const emp = await employee("91000004");
  await contract(emp, a.id);

  assert.deepEqual(await scope.applicableDevices(emp), [da]);
});

test("scope - varios contratos: la unión de sus alcances", async () => {
  const a = await company("UA");
  const b = await company("UB");
  const da = await device("UA1", a.siteId);
  const db2 = await device("UB1", b.siteId);
  const emp = await employee("91000005");
  await contract(emp, a.id);
  await contract(emp, b.id);

  assert.deepEqual(sorted(await scope.applicableDevices(emp)), sorted([da, db2]));
});

test("scope - contratos terminados, inactivos o que aún no empiezan no cuentan", async () => {
  const a = await company("FA");
  await device("FA1", a.siteId);
  const ended = await employee("91000006");
  await contract(ended, a.id, { end: -1 });
  const inactive = await employee("91000007");
  await contract(inactive, a.id, { status: "inactive" });
  const future = await employee("91000008");
  await contract(future, a.id, { start: 5 });

  assert.deepEqual(await scope.applicableDevices(ended), []);
  assert.deepEqual(await scope.applicableDevices(inactive), []);
  assert.deepEqual(await scope.applicableDevices(future), []);
});

test("scope - equipos sin sede o en una sede inactiva quedan fuera (congelados)", async () => {
  const a = await company("SA");
  const extra = await prisma.site.create({ data: { company_id: a.id, name: "Cerrada", status: "active" } });
  const da = await device("SA1", a.siteId);
  await device("SA2", extra.id);
  await device("SIN_SEDE", null);
  await prisma.site.update({ where: { id: extra.id }, data: { status: "inactive" } });
  const emp = await employee("91000009");
  await contract(emp, a.id);

  assert.deepEqual(await scope.applicableDevices(emp), [da]);
});

test("scope - sin contrato vigente no hay dónde crear nada", async () => {
  const emp = await employee("91000010");
  assert.deepEqual(await scope.applicableDevices(emp), []);
});

// --- Empresa 1..N sedes (docs/10 R2, §3.4): trigger diferido en la DB ---

test("db - no se puede crear una empresa activa sin sede", async () => {
  await assert.rejects(
    prisma.client_company.create({ data: { name: P + "SIN_SEDE", tax_id: "J-00000000-0" } }),
    /al menos una sede activa/
  );
});

test("db - no se puede desactivar la última sede activa de una empresa activa", async () => {
  const a = await company("LAST");
  await assert.rejects(
    prisma.site.update({ where: { id: a.siteId }, data: { status: "inactive" } }),
    /al menos una sede activa/
  );
  // con una segunda sede activa, sí
  await prisma.site.create({ data: { company_id: a.id, name: "Otra" } });
  await prisma.site.update({ where: { id: a.siteId }, data: { status: "inactive" } });
});

test("db - una empresa inactiva puede quedarse sin sedes activas", async () => {
  const a = await company("OFF");
  await prisma.client_company.update({ where: { id: a.id }, data: { status: "inactive" } });
  await prisma.site.update({ where: { id: a.siteId }, data: { status: "inactive" } });
  // y no se puede reactivar sin reactivar antes una sede
  await assert.rejects(
    prisma.client_company.update({ where: { id: a.id }, data: { status: "active" } }),
    /al menos una sede activa/
  );
});

// --- Aviso de impacto (lib/sync/impact.ts): la simulación usa la misma regla que el alcance ---

async function link(employeeId: number, devId: string, userId: string) {
  await prisma.employee_device_enrollment.create({ data: { employee_id: employeeId, dev_id: devId, device_user_id: userId } });
}

test("impact - terminar el único contrato: pierde los equipos donde está vinculada", async () => {
  const a = await company("IMP_A");
  const d = await device("IMP_A1", a.siteId);
  const emp = await employee("92000001");
  await contract(emp, a.id);
  await link(emp, d, "92000001");
  const emp2 = await prisma.employment.findFirst({ where: { employee_id: emp } });

  const r = await impact.previewImpact({ kind: "end_contract", employmentId: emp2!.id });
  const mine = r.losses.find((l) => l.employeeId === emp);
  assert.ok(mine);
  assert.deepEqual(mine!.devices, [d]);
});

test("impact - apagar 'compartir empleados': pierde los equipos de las otras empresas del grupo, no los propios", async () => {
  const g = await group("IMP_G", true);
  const a = await company("IMP_GA", g);
  const b = await company("IMP_GB", g);
  const da = await device("IMP_GA1", a.siteId);
  const db2 = await device("IMP_GB1", b.siteId);
  const emp = await employee("92000002");
  await contract(emp, a.id);
  await link(emp, da, "92000002");
  await link(emp, db2, "92000002");

  const r = await impact.previewImpact({ kind: "group_shared", groupId: g, shared: false });
  const mine = r.losses.find((l) => l.employeeId === emp);
  assert.deepEqual(mine?.devices, [db2], "sigue en su propia empresa, pierde la hermana");
});

test("impact - mover un equipo a una sede de otra empresa: pierden los de la empresa vieja; sin sede = congelado, nadie pierde", async () => {
  const a = await company("IMP_MA");
  const other = await company("IMP_MB");
  const d = await device("IMP_M1", a.siteId);
  const emp = await employee("92000003");
  await contract(emp, a.id);
  await link(emp, d, "92000003");

  const moved = await impact.previewImpact({ kind: "device_site", devId: d, siteId: other.siteId });
  assert.deepEqual(moved.losses.find((l) => l.employeeId === emp)?.devices, [d]);

  const unassigned = await impact.previewImpact({ kind: "device_site", devId: d, siteId: null });
  assert.equal(unassigned.losses.find((l) => l.employeeId === emp), undefined, "congelado: no se quita a nadie");
  assert.ok(unassigned.frozenDevices.length > 0);
});
