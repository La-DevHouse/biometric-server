// Consulta de la auditoría (lib/auditLog.ts): filtros, páginas y resumen de cambios.
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
const { writeAudit } = require("../lib/audit") as typeof import("../lib/audit");
const audit = require("../lib/auditLog") as typeof import("../lib/auditLog");

const P = `AUD_${Date.now()}_`;
const users: number[] = [];

after(async () => {
  await prisma.audit_log.deleteMany({ where: { actor_app_user_id: { in: users } } });
  await prisma.app_user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

test("filtros por usuario, área y fecha; páginas", async () => {
  const ana = await prisma.app_user.create({ data: { email: `${P}a@test`, name: "Ana", password_hash: "x" } });
  const beto = await prisma.app_user.create({ data: { email: `${P}b@test`, name: "Beto", password_hash: "x" } });
  users.push(ana.id, beto.id);
  await writeAudit({ actorId: ana.id, action: "company.update", entityType: "client_company", entityId: 1, before: { name: "A" }, after: { name: "B" } });
  await writeAudit({ actorId: ana.id, action: "attendance.export", entityType: "export_run", entityId: 2, after: { rows: 3 } });
  await writeAudit({ actorId: beto.id, action: "site.create", entityType: "site", entityId: 3, after: { name: "Sede" } });

  const anas = await audit.auditEntries({ actorId: ana.id });
  assert.deepEqual(anas.entries.map((e) => e.action), ["attendance.export", "company.update"]);
  assert.equal(anas.entries[1].actor, "Ana");
  assert.equal(anas.hasMore, false);

  const companies = await audit.auditEntries({ actorId: beto.id, area: "empresas" });
  assert.deepEqual(companies.entries.map((e) => e.action), ["site.create"]);
  assert.equal((await audit.auditEntries({ actorId: beto.id, area: "asistencia" })).entries.length, 0);
  // Nombre actual de lo tocado: la cuenta de Ana.
  await writeAudit({ actorId: beto.id, action: "app_user.update", entityType: "app_user", entityId: ana.id });
  assert.equal((await audit.auditEntries({ actorId: beto.id, area: "cuentas" })).entries[0].entityName, "Ana");

  // Fechas en hora de Caracas: hoy entra, mañana no.
  const today = new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
  assert.equal((await audit.auditEntries({ actorId: ana.id, from: today, to: today })).entries.length, 2);
  const tomorrow = new Date(Date.now() - 4 * 3600_000 + 86_400_000).toISOString().slice(0, 10);
  assert.equal((await audit.auditEntries({ actorId: ana.id, from: tomorrow })).entries.length, 0);

  // Página 2 vacía con pocas entradas.
  assert.equal((await audit.auditEntries({ actorId: ana.id, page: 2 })).entries.length, 0);
});

test("resumen de cambios, etiquetas y enlaces", () => {
  assert.deepEqual(
    audit.auditChanges(
      { name: "Viejo", tax_id: "J-1", updated_at: "2026-10-01T10:00:00.000Z", start_date: "2026-09-01T00:00:00.000Z" },
      { name: "Nuevo", tax_id: "J-1", updated_at: "2026-10-19T10:00:00.000Z", start_date: "2026-09-15T00:00:00.000Z" }
    ),
    [
      { field: "nombre", text: "Viejo → Nuevo" },
      { field: "inicio", text: "01/09/2026 → 15/09/2026" },
    ]
  );
  // Alta: los campos del "después", sin hash de contraseña ni vacíos.
  assert.deepEqual(audit.auditChanges(null, { name: "Ana", password_hash: "x", note: null, active: true }), [
    { field: "nombre", text: "Ana" },
    { field: "active", text: "sí" },
  ]);
  // Objetos anidados fuera; marcaciones y fechas legibles.
  assert.deepEqual(
    audit.auditChanges({ employment: { company_id: 1 }, revoked_at: null }, { revoked_at: "2026-10-19T12:50:42.506Z", io_time: "20261014170000" }),
    [
      { field: "deshecha el", text: "— → 19/10/2026, 08:50" },
      { field: "hora", text: "— → 14/10/2026 17:00" },
    ]
  );
  assert.deepEqual(audit.auditChanges(null, null), []);
  assert.equal(audit.auditActionLabel("company.update"), "Editó la empresa");
  assert.equal(audit.auditActionLabel("algo.nuevo"), "algo.nuevo");
  assert.equal(audit.auditEntityHref("client_company", "7"), "/admin/empresas/7");
  assert.equal(audit.auditEntityHref("employment", "7"), null);
});
