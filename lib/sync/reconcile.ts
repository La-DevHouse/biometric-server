// Reconciliador de huellas por equipo (docs/10-reestructura-dominio-sync.md §4.2–§4.5).
//
// Es una operación más (RECONCILE_DEVICE) que avanza con las respuestas del
// equipo, como todas: nada acá espera al equipo. Pasos:
//   1. status — GET_DEVICE_STATUS. Si fp_count/total_user_count no cambiaron desde
//      la última corrida OK, se salta la lectura (detector validado en hardware, T1).
//   2. list   — GET_USER_ID_LIST (trae exactamente los usuarios con ≥1 huella, T2).
//   3. info   — GET_USER_INFO de cada uno → caché `users` + ingesta de huellas
//               (lib/fingerprints.ts: vincula por cédula, huellas físicas nuevas →
//               copia canónica; las propagadas por nosotros nunca vuelven como nuevas).
//   4. decide — planReconcile (lib/sync/plan.ts) y ejecución: altas/completar con
//               ADD_EMPLOYEE_TO_DEVICE, bajas con DELETE_USER (verificado por conteo),
//               todo en segundo plano (prioridad 200). Freno de borrado masivo → sync_hold.
// Un equipo sin sede, o cuya sede/empresa está inactiva, está congelado: no se corre.
import { prisma } from "@/lib/db";
import { decodeUserIdList } from "@/lib/protocol";
import { writeAudit } from "@/lib/audit";
import { createOperation, queueCommandForOperation, setStage, finishOperation, BACKGROUND_PRIORITY } from "@/lib/operations/queue";
import type { OperationRow } from "@/lib/operations/queue";
import { OPERATION_LABELS } from "@/lib/operations/kinds";
import { upsertUserFromInfo, type UserInfoResult } from "@/lib/operations/persist";
import { startAddEmployeeToDevice, startDeleteUser } from "@/lib/operations";
import { ingestUserInfo, employeeIdsByCedula, cedulaDigits, desiredFingerprints, fingerprintOverflow } from "@/lib/fingerprints";
import { activeEmploymentWhere, scopeCompanyIds, applicableDevices } from "@/lib/scope";
import { planReconcile, type ReconcilePlan, type ScopedEmployee } from "./plan";

export type SyncTrigger = "cron" | "manual" | "event";

const envInt = (k: string, d: number) => {
  const n = Number(process.env[k]);
  return Number.isFinite(n) && n >= 0 ? n : d;
};
export const syncConfig = () => ({
  maxRemovals: envInt("SYNC_MAX_REMOVALS_PER_DEVICE", 5),
  maxRemovalsPct: envInt("SYNC_MAX_REMOVALS_PCT", 20),
});

interface ReconcilePlanState {
  phase: "status" | "list" | "info";
  runId: number;
  force: boolean;
  fpCount?: number;
  userCount?: number;
  pendingInfo?: string[];
  infoOk?: number;
  infoFailed?: string[];
  newFingerprintEmployees?: number[];
}

interface AdvanceInput {
  ok: boolean;
  returnCode: string;
  resultJson: Record<string, unknown> | null;
  binaries: Buffer[];
}

/** Empresa del equipo si está asignado a una sede activa de una empresa activa; si no, null (congelado). */
async function deviceCompany(devId: string): Promise<number | null> {
  const d = await prisma.devices.findUnique({
    where: { dev_id: devId },
    select: { site: { select: { status: true, company_id: true, company: { select: { status: true } } } } },
  });
  const site = d?.site;
  if (!site || site.status !== "active" || site.company.status !== "active") return null;
  return site.company_id;
}

/**
 * Encola una corrida para un equipo. Idempotente: si ya hay una en curso, devuelve
 * esa. Devuelve null si el equipo está congelado (sin sede activa) — docs/10 §3.3.
 */
export async function startReconcileDevice(
  devId: string,
  opts: { trigger: SyncTrigger; force?: boolean; actorId?: number } = { trigger: "manual" }
): Promise<number | null> {
  if ((await deviceCompany(devId)) === null) return null;

  const active = await prisma.operations.findFirst({
    where: { kind: "RECONCILE_DEVICE", dev_id: devId, stage: { in: ["queued", "sent", "waiting", "verifying"] } },
    select: { id: true },
  });
  if (active) return active.id;

  const run = await prisma.sync_run.create({
    data: { kind: "fingerprints", trigger: opts.trigger, dev_id: devId, actor_app_user_id: opts.actorId ?? null },
  });
  const plan: ReconcilePlanState = { phase: "status", runId: run.id, force: !!opts.force };
  const opId = await createOperation({
    kind: "RECONCILE_DEVICE",
    label: `${OPERATION_LABELS.RECONCILE_DEVICE} (${opts.trigger === "cron" ? "automática" : opts.trigger === "event" ? "por un cambio" : "manual"})`,
    devId,
    plan,
    stepTotal: 3,
    priority: BACKGROUND_PRIORITY,
  });
  await prisma.sync_run.update({ where: { id: run.id }, data: { op_id: opId } });
  await queueCommandForOperation(opId, devId, "GET_DEVICE_STATUS", {});
  return opId;
}

/** Dispara corridas para estos equipos (los congelados se saltan solos). Devuelve los ids de operación. */
export async function triggerReconcile(
  devIds: Iterable<string>,
  trigger: SyncTrigger = "event",
  actorId?: number
): Promise<number[]> {
  const ids: number[] = [];
  for (const devId of new Set(devIds)) {
    try {
      const id = await startReconcileDevice(devId, { trigger, actorId });
      if (id !== null) ids.push(id);
    } catch (e) {
      console.error("[sync] no se pudo encolar la corrida de", devId, e);
    }
  }
  return ids;
}

/** Todos los equipos asignados a una sede — lo que corre el cron. */
export async function reconcileAll(trigger: SyncTrigger = "cron", actorId?: number): Promise<number[]> {
  const devices = await prisma.devices.findMany({ where: { site_id: { not: null } }, select: { dev_id: true } });
  return triggerReconcile(
    devices.map((d) => d.dev_id),
    trigger,
    actorId
  );
}

/** Equipos cuyo alcance incluye a alguien con contrato en esta empresa (y su grupo si comparte). */
export async function devicesAffectedByCompany(companyId: number): Promise<string[]> {
  const ids = await scopeCompanyIds(companyId);
  const rows = await prisma.devices.findMany({
    where: { site: { company_id: { in: ids } } },
    select: { dev_id: true },
  });
  return rows.map((r) => r.dev_id);
}

/**
 * Equipos donde un cambio en los contratos de esta persona puede requerir
 * trabajo: los de su alcance actual (altas) ∪ donde hoy está vinculada (bajas).
 */
export async function devicesAffectedByEmployee(employeeId: number): Promise<string[]> {
  const [scoped, linked] = await Promise.all([
    applicableDevices(employeeId),
    prisma.employee_device_enrollment.findMany({
      where: { employee_id: employeeId, status: "active" },
      select: { dev_id: true },
    }),
  ]);
  return [...new Set([...scoped, ...linked.map((l) => l.dev_id)])];
}

/** Equipos de todas las empresas de un grupo (al cambiar su flag o su estado). */
export async function devicesOfGroup(groupId: number): Promise<string[]> {
  const rows = await prisma.devices.findMany({
    where: { site: { company: { group_id: groupId } } },
    select: { dev_id: true },
  });
  return rows.map((r) => r.dev_id);
}

async function lastCounts(devId: string, excludeRunId: number) {
  const last = await prisma.sync_run.findFirst({
    where: { dev_id: devId, kind: "fingerprints", ok: true, id: { not: excludeRunId } },
    orderBy: { started_at: "desc" },
    select: { stats: true },
  });
  const s = (last?.stats ?? null) as { fp_count?: number; user_count?: number } | null;
  return s && typeof s.fp_count === "number" && typeof s.user_count === "number" ? s : null;
}

async function finishRun(runId: number, ok: boolean, stats: Record<string, unknown>) {
  await prisma.sync_run.update({
    where: { id: runId },
    data: { finished_at: new Date(), ok, stats: stats as object },
  });
}

/** Paso a paso de RECONCILE_DEVICE — lo llama advance.ts con cada respuesta del equipo. */
export async function advanceReconcile(op: OperationRow, input: AdvanceInput): Promise<void> {
  const plan: ReconcilePlanState = op.plan_json ? JSON.parse(op.plan_json) : { phase: "status", runId: 0, force: false };

  if (plan.phase === "status") {
    const fp = Number(input.resultJson?.fp_count);
    const users = Number(input.resultJson?.total_user_count);
    if (!input.ok || !Number.isFinite(fp) || !Number.isFinite(users)) {
      await finishRun(plan.runId, false, { error: `estado ilegible (${input.returnCode})` });
      await finishOperation(op.id, "error", "No se pudo leer el estado del equipo; se reintenta en la próxima corrida.");
      return;
    }
    const prev = await lastCounts(op.dev_id, plan.runId);
    const changed = plan.force || !prev || prev.fp_count !== fp || prev.user_count !== users;
    const next: ReconcilePlanState = { ...plan, fpCount: fp, userCount: users };
    if (!changed) {
      await decideAndApply(op, { ...next, infoOk: 0, infoFailed: [] }, false);
      return;
    }
    await setStage(op.id, "waiting", { plan: { ...next, phase: "list" }, stepIndex: 1 });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_ID_LIST", {});
    return;
  }

  if (plan.phase === "list") {
    const count = input.resultJson?.user_id_count;
    const listed = !input.ok ? null : count === 0 ? [] : decodeUserIdList(input.resultJson, input.binaries);
    if (listed === null) {
      await finishRun(plan.runId, false, { error: "lista de usuarios ilegible" });
      await finishOperation(op.id, "error", "No se pudo leer la lista de usuarios del equipo; se reintenta en la próxima corrida.");
      return;
    }
    // Además de los que tienen huella (la lista), los vinculados que no aparecen:
    // puede ser alguien sin huella todavía — se relee para conocer su privilegio.
    const linked = await prisma.employee_device_enrollment.findMany({
      where: { dev_id: op.dev_id, status: "active" },
      select: { device_user_id: true },
    });
    const pending = [...new Set([...listed, ...linked.map((l) => l.device_user_id)])];
    await nextInfo(op, { ...plan, phase: "info", pendingInfo: pending, infoOk: 0, infoFailed: [], newFingerprintEmployees: [] });
    return;
  }

  // phase === "info": resultado del GET_USER_INFO de pendingInfo[0]
  const [current, ...rest] = plan.pendingInfo ?? [];
  const infoFailed = [...(plan.infoFailed ?? [])];
  const newEmployees = new Set(plan.newFingerprintEmployees ?? []);
  let infoOk = plan.infoOk ?? 0;
  if (input.ok && input.resultJson?.user_name) {
    const info = input.resultJson as UserInfoResult;
    await upsertUserFromInfo(op.dev_id, info, input.binaries);
    const ingest = await ingestUserInfo(op.dev_id, info, input.binaries);
    if (ingest.employeeId !== null && ingest.newFingerprintIds.length > 0) newEmployees.add(ingest.employeeId);
    infoOk++;
  } else if (current) {
    infoFailed.push(current);
  }
  await nextInfo(op, {
    ...plan,
    pendingInfo: rest,
    infoOk,
    infoFailed,
    newFingerprintEmployees: [...newEmployees],
  });
}

async function nextInfo(op: OperationRow, plan: ReconcilePlanState): Promise<void> {
  const [next] = plan.pendingInfo ?? [];
  if (next === undefined) {
    await decideAndApply(op, plan, true);
    return;
  }
  // 'verifying' (no 'waiting'): un GET_USER_INFO colgado expira en 25 s en vez
  // de 3 min (sweepStaleOperations) y vuelve acá como fallo de ese usuario.
  await setStage(op.id, "verifying", { plan, stepTotal: 3 + (plan.pendingInfo?.length ?? 0), stepIndex: 2 });
  await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: next });
}

/** Empleados en el alcance de este equipo + qué copias les faltan acá. */
async function scopedEmployees(devId: string, companyId: number): Promise<ScopedEmployee[]> {
  const companyIds = await scopeCompanyIds(companyId);
  const employees = await prisma.employee.findMany({
    where: { employments: { some: { company_id: { in: companyIds }, company: { status: "active" }, ...activeEmploymentWhere() } } },
    select: { id: true, national_id: true, first_name: true, last_name: true },
  });
  const out: ScopedEmployee[] = [];
  for (const e of employees) {
    const cedula = cedulaDigits(e.national_id);
    if (!cedula) continue;
    const desired = await desiredFingerprints(e.id);
    const onDevice = new Set(
      (
        await prisma.device_fingerprint_slot.findMany({
          where: { dev_id: devId, device_user_id: cedula, fingerprint_id: { not: null } },
          select: { fingerprint_id: true },
        })
      ).map((s) => s.fingerprint_id)
    );
    out.push({
      employeeId: e.id,
      cedula,
      name: `${e.first_name} ${e.last_name}`.trim(),
      missingFingerprints: desired.filter((f) => !onDevice.has(f.id)).length,
    });
  }
  return out;
}

async function decideAndApply(op: OperationRow, plan: ReconcilePlanState, readDevice: boolean): Promise<void> {
  const devId = op.dev_id;
  const companyId = await deviceCompany(devId);
  if (companyId === null) {
    await finishRun(plan.runId, true, { fp_count: plan.fpCount, user_count: plan.userCount, frozen: true });
    await finishOperation(op.id, "done", "Equipo sin sede activa: congelado, no se tocó nada.");
    return;
  }

  const [inScope, cachedUsers, linked, byCedula] = await Promise.all([
    scopedEmployees(devId, companyId),
    prisma.users.findMany({ where: { dev_id: devId }, select: { user_id: true, user_privilege: true } }),
    prisma.employee_device_enrollment.findMany({ where: { dev_id: devId, status: "active" }, select: { device_user_id: true } }),
    employeeIdsByCedula(),
  ]);
  const deviceUsers = new Map(cachedUsers.map((u) => [u.user_id, u.user_privilege ?? null]));
  for (const l of linked) if (!deviceUsers.has(l.device_user_id)) deviceUsers.set(l.device_user_id, null);

  const cfg = syncConfig();
  const decision = planReconcile({
    inScope,
    deviceUsers: [...deviceUsers].map(([userId, privilege]) => ({ userId, privilege })),
    employeeByCedula: byCedula,
    maxRemovals: cfg.maxRemovals,
    maxRemovalsPct: cfg.maxRemovalsPct,
  });

  const notes = await apply(devId, decision);

  // Huellas físicas nuevas ingeridas acá → los demás equipos de esas personas
  // tienen que recibirlas: se les dispara su propia corrida (docs/10 §4.3).
  const others = new Set<string>();
  for (const employeeId of plan.newFingerprintEmployees ?? []) {
    for (const d of await applicableDevices(employeeId)) if (d !== devId) others.add(d);
  }
  const propagated = others.size ? (await triggerReconcile(others, "event")).length : 0;

  const overflow: Array<{ employee_id: number; extra: number }> = [];
  for (const e of inScope) {
    const extra = await fingerprintOverflow(e.employeeId);
    if (extra > 0) overflow.push({ employee_id: e.employeeId, extra });
  }

  const stats = {
    fp_count: plan.fpCount,
    user_count: plan.userCount,
    read_device: readDevice,
    info_ok: plan.infoOk ?? 0,
    info_failed: plan.infoFailed ?? [],
    in_scope: inScope.length,
    added: decision.add.length,
    completed: decision.complete.length,
    removed: decision.remove.length,
    held: decision.held.length,
    protected: decision.protectedUsers,
    unknown: decision.unknownUsers,
    overflow,
    propagated_to: propagated,
    errors: notes,
  };
  await finishRun(plan.runId, true, stats);

  const parts = [
    readDevice ? `${plan.infoOk ?? 0} usuario(s) leídos` : "sin cambios en el equipo",
    decision.add.length && `${decision.add.length} alta(s)`,
    decision.complete.length && `${decision.complete.length} a completar huellas`,
    decision.remove.length && `${decision.remove.length} baja(s)`,
    decision.held.length && `⚠ ${decision.held.length} baja(s) frenadas: requieren aprobación`,
    decision.unknownUsers.length && `${decision.unknownUsers.length} ID(s) sin empleado`,
    overflow.length && `${overflow.length} persona(s) con más de 10 huellas`,
    notes.length && `${notes.length} aviso(s)`,
  ].filter(Boolean);
  await finishOperation(op.id, "done", `${parts.join(" · ")}.`);
}

/** Ejecuta el plan. Devuelve los fallos no fatales (uno por acción). */
async function apply(devId: string, d: ReconcilePlan): Promise<string[]> {
  const notes: string[] = [];
  for (const e of [...d.add, ...d.complete]) {
    try {
      await startAddEmployeeToDevice(devId, { employeeId: e.employeeId, userName: e.name, privilege: "USER" }, { background: true });
    } catch (err) {
      notes.push(`${e.cedula}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  for (const r of d.remove) {
    try {
      await startDeleteUser(devId, r.userId, { background: true, reason: "fuera del alcance" });
      await writeAudit({
        actorId: null,
        action: "device_user.remove",
        entityType: "devices",
        entityId: devId,
        after: { user_id: r.userId, employee_id: r.employeeId, reason: "fuera del alcance (reconciliador)" },
      });
    } catch (err) {
      notes.push(`baja ${r.userId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (d.held.length) {
    const planned = d.held.map((h) => ({ user_id: h.userId, employee_id: h.employeeId }));
    const open = await prisma.sync_hold.findFirst({ where: { dev_id: devId, resolved_at: null } });
    if (open) await prisma.sync_hold.update({ where: { id: open.id }, data: { planned_removals: planned } });
    else await prisma.sync_hold.create({ data: { dev_id: devId, planned_removals: planned } });
  }
  return notes;
}

/**
 * Aprobar o rechazar un freno de borrado masivo. Al aprobar se re-valida cada
 * baja contra el alcance ACTUAL (puede haber cambiado desde que se frenó) y
 * contra las salvaguardas; los que siguen fuera se borran.
 */
export async function resolveSyncHold(holdId: number, approve: boolean, actorId: number): Promise<{ started: number }> {
  const hold = await prisma.sync_hold.findUnique({ where: { id: holdId } });
  if (!hold || hold.resolved_at) throw new Error("Ese freno ya no está pendiente.");
  await prisma.sync_hold.update({
    where: { id: holdId },
    data: { resolved_at: new Date(), resolved_by: actorId, resolution: approve ? "approved" : "rejected" },
  });
  await writeAudit({
    actorId,
    action: approve ? "sync_hold.approve" : "sync_hold.reject",
    entityType: "sync_hold",
    entityId: holdId,
    after: { dev_id: hold.dev_id, planned_removals: hold.planned_removals },
  });
  if (!approve) return { started: 0 };

  const companyId = await deviceCompany(hold.dev_id);
  if (companyId === null) return { started: 0 };
  const inScope = new Set((await scopedEmployees(hold.dev_id, companyId)).map((e) => e.cedula));
  const cached = new Map(
    (await prisma.users.findMany({ where: { dev_id: hold.dev_id }, select: { user_id: true, user_privilege: true } })).map((u) => [
      u.user_id,
      u.user_privilege,
    ])
  );
  let started = 0;
  for (const r of hold.planned_removals as Array<{ user_id: string; employee_id: number }>) {
    const priv = cached.get(r.user_id) ?? null;
    if (inScope.has(r.user_id) || priv === null || priv === "MANAGER" || priv === "OPERATOR") continue;
    await startDeleteUser(hold.dev_id, r.user_id, { background: true, reason: "fuera del alcance (aprobado)" });
    await writeAudit({
      actorId,
      action: "device_user.remove",
      entityType: "devices",
      entityId: hold.dev_id,
      after: { user_id: r.user_id, employee_id: r.employee_id, reason: "fuera del alcance (freno aprobado)" },
    });
    started++;
  }
  return { started };
}
