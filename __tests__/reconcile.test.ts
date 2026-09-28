import { test, after } from "node:test";
import { strict as assert } from "node:assert";

// Igual que los otros archivos: apuntar a la base de tests ANTES del require().
{
  const base =
    process.env.DATABASE_URL ??
    "postgresql://biometric:biometric@localhost:55432/biometric?schema=public";
  process.env.DATABASE_URL =
    process.env.TEST_DATABASE_URL ?? base.replace(/(\/\/[^/]+\/)[^/?]+/, "$1biometric_test");
}

const db = require("../lib/db") as typeof import("../lib/db");
const ops = require("../lib/operations") as typeof import("../lib/operations");
const advance = require("../lib/operations/advance") as typeof import("../lib/operations/advance");
const plan = require("../lib/sync/plan") as typeof import("../lib/sync/plan");
const reconcile = require("../lib/sync/reconcile") as typeof import("../lib/sync/reconcile");
const { prisma } = db;

// ---------------------------------------------------------------------------
// planReconcile — decisión pura (docs/10 §4.2, salvaguardas §4.5)
// ---------------------------------------------------------------------------

const cfg = { maxRemovals: 5, maxRemovalsPct: 20 };
const emp = (cedula: string, missing = 0) => ({ employeeId: Number(cedula), cedula, name: cedula, missingFingerprints: missing });

test("plan - en el alcance y ausente del equipo → alta", () => {
  const p = plan.planReconcile({ ...cfg, inScope: [emp("1")], deviceUsers: [], employeeByCedula: new Map([["1", 1]]) });
  assert.deepEqual(p.add.map((e) => e.cedula), ["1"]);
  assert.deepEqual(p.complete, []);
});

test("plan - presente con huellas faltantes → completar; completo → nada", () => {
  const p = plan.planReconcile({
    ...cfg,
    inScope: [emp("1", 2), emp("2", 0)],
    deviceUsers: [
      { userId: "1", privilege: "USER" },
      { userId: "2", privilege: "USER" },
    ],
    employeeByCedula: new Map([
      ["1", 1],
      ["2", 2],
    ]),
  });
  assert.deepEqual(p.add, []);
  assert.deepEqual(p.complete.map((e) => e.cedula), ["1"]);
  assert.deepEqual(p.remove, []);
});

test("plan - fuera del alcance: se quita solo a empleados conocidos, nunca admins ni privilegio desconocido ni cédulas ajenas", () => {
  const p = plan.planReconcile({
    ...cfg,
    inScope: [],
    deviceUsers: [
      { userId: "10", privilege: "USER" }, // empleado fuera del alcance → baja
      { userId: "11", privilege: "MANAGER" }, // admin → nunca
      { userId: "12", privilege: "OPERATOR" }, // super usuario → nunca
      { userId: "13", privilege: null }, // privilegio desconocido → nunca
      { userId: "7", privilege: "USER" }, // no es cédula de nadie → desajuste, no se toca
    ],
    employeeByCedula: new Map([
      ["10", 10],
      ["11", 11],
      ["12", 12],
      ["13", 13],
    ]),
  });
  assert.deepEqual(p.remove, [{ userId: "10", employeeId: 10 }]);
  assert.deepEqual(p.protectedUsers.sort(), ["11", "12", "13"]);
  assert.deepEqual(p.unknownUsers, ["7"]);
});

test("plan - freno de borrado masivo: por encima del umbral no se borra nada, todo queda frenado", () => {
  const users = Array.from({ length: 10 }, (_, i) => ({ userId: String(100 + i), privilege: "USER" }));
  const byCedula = new Map(users.map((u) => [u.userId, Number(u.userId)]));
  // umbral = max(5, 20% de 10 = 2) = 5
  const five = plan.planReconcile({ ...cfg, inScope: users.slice(5).map((u) => emp(u.userId)), deviceUsers: users, employeeByCedula: byCedula });
  assert.equal(five.remove.length, 5);
  assert.equal(five.held.length, 0);
  const six = plan.planReconcile({ ...cfg, inScope: users.slice(6).map((u) => emp(u.userId)), deviceUsers: users, employeeByCedula: byCedula });
  assert.equal(six.remove.length, 0);
  assert.equal(six.held.length, 6);
});

// ---------------------------------------------------------------------------
// RECONCILE_DEVICE de punta a punta contra la base de tests
// ---------------------------------------------------------------------------

const P = `REC_${Date.now()}_`;
const DEV = P + "DEV";
const DEV_FROZEN = P + "FROZEN";
const DEV_AUD = P + "AUD";
const DEV_STALE = P + "STALE";
const made = { companies: [] as number[], employees: [] as number[], appUsers: [] as number[] };

after(async () => {
  await prisma.employment.deleteMany({ where: { employee_id: { in: made.employees } } });
  await prisma.employee.deleteMany({ where: { id: { in: made.employees } } });
  await db.runAsync(`DELETE FROM commands WHERE dev_id IN (?, ?, ?, ?)`, [DEV, DEV_FROZEN, DEV_AUD, DEV_STALE]);
  await db.runAsync(`DELETE FROM operations WHERE dev_id IN (?, ?, ?, ?)`, [DEV, DEV_FROZEN, DEV_AUD, DEV_STALE]);
  await db.runAsync(`DELETE FROM users WHERE dev_id IN (?, ?, ?, ?)`, [DEV, DEV_FROZEN, DEV_AUD, DEV_STALE]);
  await db.runAsync(`DELETE FROM enroll_data WHERE dev_id IN (?, ?, ?, ?)`, [DEV, DEV_FROZEN, DEV_AUD, DEV_STALE]);
  await prisma.audit_log.deleteMany({ where: { entity_id: DEV_AUD } });
  await prisma.devices.deleteMany({ where: { dev_id: { in: [DEV, DEV_FROZEN, DEV_AUD, DEV_STALE] } } });
  await prisma.client_company.deleteMany({ where: { id: { in: made.companies } } });
  await prisma.audit_log.deleteMany({ where: { actor_app_user_id: { in: made.appUsers } } });
  await prisma.app_user.deleteMany({ where: { id: { in: made.appUsers } } });
  await prisma.$disconnect();
});

/** ¿Hay un alta (lote) en curso para este empleado en el equipo? */
async function batchHas(devId: string, employeeId: number): Promise<boolean> {
  const rows = await db.allAsync<{ params_json: string }>(
    `SELECT params_json FROM operations WHERE dev_id = ? AND kind = 'ADD_EMPLOYEES_BATCH'`,
    [devId]
  );
  return rows.some((r) => (JSON.parse(r.params_json).employeeIds as number[]).includes(employeeId));
}

async function currentCommand(opId: number) {
  const cmds = await ops.getOperationCommands(opId);
  return cmds[cmds.length - 1];
}

async function step(opId: number, result: { ok: boolean; returnCode?: string; resultJson?: Record<string, unknown> | null; binaries?: Buffer[] }) {
  const cmd = await currentCommand(opId);
  await advance.advanceOperationForCommand({
    opId,
    devId: DEV,
    transId: cmd.trans_id,
    cmdCode: cmd.cmd_code,
    ok: result.ok,
    returnCode: result.returnCode ?? (result.ok ? "OK" : "Error"),
    resultJson: (result.resultJson ?? null) as Record<string, any> | null,
    binaries: result.binaries ?? [],
  });
}

const le = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
};
const idList = (ids: number[]) => ({
  ok: true,
  resultJson: { user_id_count: ids.length, one_user_id_size: 8, user_id_array: "BIN_1" },
  binaries: [Buffer.concat(ids.map((n) => Buffer.concat([le(n), Buffer.from([1, 1, 8, 0])])))],
});
const template = (userId: number) => {
  const b = Buffer.alloc(612, 0xab);
  b.writeUInt32LE(userId, 608);
  return b;
};
const info = (userId: number, privilege: string, slots: number[]) => ({
  ok: true,
  resultJson: {
    user_id: String(userId),
    user_name: "u" + userId,
    user_privilege: privilege,
    enroll_data_array: slots.map((bn, i) => ({ backup_number: bn, enroll_data: `BIN_${i + 1}` })),
  },
  binaries: slots.map(() => template(userId)),
});

async function employee(cedula: string, withContractIn: number | null) {
  const e = await prisma.employee.create({ data: { national_id: "V" + cedula, first_name: "R", last_name: P } });
  made.employees.push(e.id);
  if (withContractIn) {
    await prisma.employment.create({ data: { employee_id: e.id, company_id: withContractIn, start_date: new Date("2026-01-01") } });
  }
  return e.id;
}

test("reconcile - un equipo sin sede está congelado: no se corre", async () => {
  await prisma.devices.create({ data: { dev_id: DEV_FROZEN, site_id: null } });
  assert.equal(await reconcile.startReconcileDevice(DEV_FROZEN, { trigger: "manual" }), null);
});

test("reconcile - corrida completa: altas, ingesta física, bajas con salvaguardas, y la segunda corrida no duplica nada", async () => {
  const c = await prisma.client_company.create({
    data: { name: P + "C", tax_id: "J-1", sites: { create: { name: "S" } } },
    include: { sites: true },
  });
  made.companies.push(c.id);
  await prisma.devices.create({ data: { dev_id: DEV, site_id: c.sites[0].id, last_seen_at: BigInt(Date.now()) } });

  const inScope = await employee("50000001", c.id); // contrato vigente, no está en el equipo → alta
  const leaver = await employee("50000002", null); // sin contrato, está en el equipo → baja
  await employee("50000003", null); // MANAGER fuera del alcance → nunca se toca

  const opId = (await reconcile.startReconcileDevice(DEV, { trigger: "manual" }))!;
  assert.ok(opId);
  assert.equal((await currentCommand(opId)).cmd_code, "GET_DEVICE_STATUS");
  const row = await db.getAsync<{ priority: number }>(`SELECT priority FROM commands WHERE op_id = ?`, [opId]);
  assert.equal(row!.priority, 200, "el reconciliador corre en segundo plano");

  await step(opId, { ok: true, resultJson: { fp_count: "3", total_user_count: "3" } });
  assert.equal((await currentCommand(opId)).cmd_code, "GET_USER_ID_LIST", "primera corrida: sin contadores previos → lee el equipo");
  await step(opId, idList([50000002, 50000003, 7]));

  await step(opId, info(50000002, "USER", [0]));
  await step(opId, info(50000003, "MANAGER", [0]));
  await step(opId, info(7, "USER", [0]));

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  assert.match(op!.note ?? "", /1 alta\(s\)/);
  assert.match(op!.note ?? "", /1 baja\(s\)/);
  assert.match(op!.note ?? "", /1 ID\(s\) sin empleado/);

  const children = await db.allAsync<{ kind: string; user_id: string; priority: number }>(
    `SELECT kind, user_id, priority FROM operations WHERE dev_id = ? AND id <> ? ORDER BY id`,
    [DEV, opId]
  );
  assert.deepEqual(
    children.map((c) => [c.kind, c.user_id, c.priority]),
    [
      ["ADD_EMPLOYEES_BATCH", null, 200],
      ["DELETE_USER", "50000002", 200],
    ],
    "alta del que falta (en lote) y baja del que sobra — ni el admin (50000003) ni el ID ajeno (7)"
  );
  assert.ok(await batchHas(DEV, inScope));

  // La huella física de 50000002 se ingirió (copia canónica + slot physical) antes de decidir.
  const fp = await prisma.employee_fingerprint.count({ where: { employee_id: leaver } });
  assert.equal(fp, 1);

  const run = await prisma.sync_run.findFirst({ where: { op_id: opId } });
  assert.equal(run?.ok, true);
  const stats = run!.stats as Record<string, unknown>;
  assert.equal(stats.fp_count, 3);
  assert.deepEqual(stats.protected, ["50000003"]);

  // Segunda corrida con los mismos contadores: no relee el equipo y no duplica operaciones.
  const op2 = (await reconcile.startReconcileDevice(DEV, { trigger: "cron" }))!;
  await step(op2, { ok: true, resultJson: { fp_count: "3", total_user_count: "3" } });
  const after2 = await ops.getOperation(op2);
  assert.equal(after2?.stage, "done");
  assert.match(after2!.note ?? "", /sin cambios en el equipo/);
  const kinds = await db.allAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM operations WHERE dev_id = ? AND kind IN ('ADD_EMPLOYEES_BATCH','DELETE_USER')`,
    [DEV]
  );
  assert.equal(kinds[0].n, 2, "las operaciones en curso se reusan, no se duplican");
});

test("reconcile - freno de borrado masivo: crea sync_hold y no borra; al aprobarlo, borra lo que sigue fuera", async () => {
  // Cerrar lo que dejó el test anterior para empezar limpio en el mismo equipo.
  await db.runAsync(`UPDATE operations SET stage = 'canceled' WHERE dev_id = ? AND stage NOT IN ('done','mismatch','error','canceled')`, [DEV]);
  await db.runAsync(`UPDATE commands SET status = 'ERROR' WHERE dev_id = ? AND status IN ('WAIT','RUN')`, [DEV]);
  process.env.SYNC_MAX_REMOVALS_PER_DEVICE = "0";
  process.env.SYNC_MAX_REMOVALS_PCT = "0";
  try {
    const opId = (await reconcile.startReconcileDevice(DEV, { trigger: "manual", force: true }))!;
    await step(opId, { ok: true, resultJson: { fp_count: "3", total_user_count: "3" } });
    await step(opId, idList([50000002]));
    await step(opId, info(50000002, "USER", [0]));
    // el vínculo de 50000002 (creado por la ingesta) también se relee
    while ((await ops.getOperation(opId))?.stage !== "done") await step(opId, info(50000002, "USER", [0]));

    const note = (await ops.getOperation(opId))!.note ?? "";
    assert.match(note, /frenadas: requieren aprobación/);
    const hold = await prisma.sync_hold.findFirst({ where: { dev_id: DEV, resolved_at: null } });
    assert.ok(hold);
    const deletes = await db.getAsync<{ n: number }>(
      `SELECT COUNT(*) AS n FROM operations WHERE dev_id = ? AND kind = 'DELETE_USER' AND stage NOT IN ('done','mismatch','error','canceled')`,
      [DEV]
    );
    assert.equal(deletes!.n, 0, "con el freno activo no se borra nada");

    const admin = await prisma.app_user.create({ data: { email: `${P}@test`, name: "t", password_hash: "x" } });
    made.appUsers.push(admin.id);
    const { started } = await reconcile.resolveSyncHold(hold!.id, true, admin.id);
    assert.equal(started, 1);
    const resolved = await prisma.sync_hold.findUnique({ where: { id: hold!.id } });
    assert.equal(resolved?.resolution, "approved");
  } finally {
    delete process.env.SYNC_MAX_REMOVALS_PER_DEVICE;
    delete process.env.SYNC_MAX_REMOVALS_PCT;
  }
});

// --- Revisión nocturna (docs/10 §4.2 / O9) ---

test("auditVerdict - cuadra por conteo: solo poda si los confirmados son exactamente los sin-huella del equipo", () => {
  // El equipo tiene 1 usuario sin huella; de los 2 que conocemos, contestó 1 → el otro ya no está.
  assert.deepEqual(plan.auditVerdict({ check: ["A", "B"], confirmed: ["B"], deviceNoFp: 1 }), { exact: true, gone: ["A"] });
  // El equipo tiene 2 sin huella pero solo reconocemos 1: hay alguien que no conocemos → no se toca nada.
  assert.deepEqual(plan.auditVerdict({ check: ["A", "B"], confirmed: ["B"], deviceNoFp: 2 }), { exact: false, gone: [] });
  // Todos contestaron y cierra: exacta, nadie que podar.
  assert.deepEqual(plan.auditVerdict({ check: ["A"], confirmed: ["A"], deviceNoFp: 1 }), { exact: true, gone: [] });
  // Sin dato del equipo: nunca se poda.
  assert.deepEqual(plan.auditVerdict({ check: ["A"], confirmed: [], deviceNoFp: undefined }), { exact: false, gone: [] });
});

test("reconcile - revisión nocturna: quien fue borrado desde el teclado sale de la caché y se vuelve a crear", async () => {
  const c = await prisma.client_company.create({
    data: { name: P + "AUD", tax_id: "J-2", sites: { create: { name: "S" } } },
    include: { sites: true },
  });
  made.companies.push(c.id);
  await prisma.devices.create({ data: { dev_id: DEV_AUD, site_id: c.sites[0].id, last_seen_at: BigInt(Date.now()) } });

  const borrado = await employee("50000011", c.id); // vinculado, sin huella… pero lo borraron en el teclado
  const sigue = await employee("50000012", c.id); // vinculado, sin huella, sigue en el equipo
  for (const [emp, id] of [[borrado, "50000011"], [sigue, "50000012"]] as const) {
    await db.runAsync(`INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, ?, 'x', 'USER')`, [DEV_AUD, id]);
    await prisma.employee_device_enrollment.create({ data: { employee_id: emp, dev_id: DEV_AUD, device_user_id: id } });
  }
  await db.runAsync(`INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, '9001', 'Admin', 'MANAGER')`, [DEV_AUD]);
  await db.runAsync(`INSERT INTO enroll_data (dev_id, user_id, backup_number, data) VALUES (?, '9001', 0, ?)`, [DEV_AUD, template(9001)]);

  const stepAud = async (opId: number, result: Parameters<typeof step>[1]) => {
    const cmds = await ops.getOperationCommands(opId);
    const cmd = cmds[cmds.length - 1];
    await advance.advanceOperationForCommand({
      opId, devId: DEV_AUD, transId: cmd.trans_id, cmdCode: cmd.cmd_code, ok: result.ok,
      returnCode: result.returnCode ?? (result.ok ? "OK" : "Error"),
      resultJson: (result.resultJson ?? null) as Record<string, any> | null, binaries: result.binaries ?? [],
    });
  };

  const opId = (await reconcile.startReconcileDevice(DEV_AUD, { trigger: "cron", audit: true }))!;
  // El equipo: 9001 (con huella) + 50000012 (sin huella) = 2 usuarios, 1 huella.
  await stepAud(opId, { ok: true, resultJson: { fp_count: "1", total_user_count: "2" } });
  await stepAud(opId, idList([9001]));
  // Se consulta a los que conocemos sin huella: 50000011 no contesta, 50000012 sí.
  const asked: string[] = [];
  for (let i = 0; i < 2; i++) {
    const cmd = (await ops.getOperationCommands(opId)).at(-1)!;
    assert.equal(cmd.cmd_code, "GET_USER_INFO");
    const uid = JSON.parse(cmd.cmd_param ?? "{}").user_id as string;
    asked.push(uid);
    await stepAud(opId, uid === "50000012" ? { ok: true, resultJson: { user_id: uid, user_name: "x", user_privilege: "USER" } } : { ok: false, returnCode: "TIMEOUT" });
  }
  assert.deepEqual(asked.sort(), ["50000011", "50000012"]);

  const op = await ops.getOperation(opId);
  assert.equal(op?.stage, "done");
  const run = await prisma.sync_run.findFirst({ where: { op_id: opId } });
  const stats = run!.stats as Record<string, unknown>;
  assert.equal(stats.audit, true);
  assert.equal(stats.cache_exact, true);
  assert.deepEqual(stats.audit_gone, ["50000011"]);

  assert.equal(await prisma.users.count({ where: { dev_id: DEV_AUD, user_id: "50000011" } }), 0, "fuera de la caché");
  assert.equal(await prisma.users.count({ where: { dev_id: DEV_AUD, user_id: "50000012" } }), 1, "el que contestó queda");
  const link = await prisma.employee_device_enrollment.findFirst({ where: { employee_id: borrado, dev_id: DEV_AUD } });
  assert.equal(link?.status, "inactive");
  assert.ok(await batchHas(DEV_AUD, borrado), "sigue en el alcance → se lo vuelve a crear en el equipo");
  assert.equal(await batchHas(DEV_AUD, sigue), false, "al que sigue no se lo toca");
});

test("reconcile - quien tenía huellas y ya no aparece en la lista (borrado en el teclado): se re-copian en la misma corrida", async () => {
  const c = await prisma.client_company.create({
    data: { name: P + "STALE", tax_id: "J-3", sites: { create: { name: "S" } } },
    include: { sites: true },
  });
  made.companies.push(c.id);
  await prisma.devices.create({ data: { dev_id: DEV_STALE, site_id: c.sites[0].id, last_seen_at: BigInt(Date.now()) } });
  const emp = await employee("50000021", c.id);
  const fp = await prisma.employee_fingerprint.create({ data: { employee_id: emp, template: template(50000021) } });
  // Antes: estaba en el equipo con su huella (caché, vínculo y registro de slot).
  await db.runAsync(`INSERT INTO users (dev_id, user_id, user_name, user_privilege) VALUES (?, '50000021', 'x', 'USER')`, [DEV_STALE]);
  await db.runAsync(`INSERT INTO enroll_data (dev_id, user_id, backup_number, data) VALUES (?, '50000021', 0, ?)`, [DEV_STALE, template(50000021)]);
  await prisma.employee_device_enrollment.create({ data: { employee_id: emp, dev_id: DEV_STALE, device_user_id: "50000021" } });
  await prisma.device_fingerprint_slot.create({
    data: { dev_id: DEV_STALE, device_user_id: "50000021", backup_number: 0, fingerprint_id: fp.id, origin: "propagated" },
  });

  const stepS = async (opId: number, result: Parameters<typeof step>[1]) => {
    const cmd = (await ops.getOperationCommands(opId)).at(-1)!;
    await advance.advanceOperationForCommand({
      opId, devId: DEV_STALE, transId: cmd.trans_id, cmdCode: cmd.cmd_code, ok: result.ok,
      returnCode: result.returnCode ?? (result.ok ? "OK" : "Error"),
      resultJson: (result.resultJson ?? null) as Record<string, any> | null, binaries: result.binaries ?? [],
    });
  };
  // Ahora: lo borraron en el teclado → el equipo quedó vacío.
  const opId = (await reconcile.startReconcileDevice(DEV_STALE, { trigger: "event" }))!;
  await stepS(opId, { ok: true, resultJson: { fp_count: "0", total_user_count: "0" } });
  await stepS(opId, { ok: true, resultJson: { user_id_count: 0 } });

  assert.equal((await ops.getOperation(opId))?.stage, "done");
  assert.equal(await prisma.device_fingerprint_slot.count({ where: { dev_id: DEV_STALE } }), 0, "registro de slots limpio");
  assert.ok(await batchHas(DEV_STALE, emp), "se vuelve a copiar en esta misma corrida, sin esperar la revisión nocturna");
});
