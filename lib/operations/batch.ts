// ADD_EMPLOYEES_BATCH: altas y huellas de varias personas en un equipo, en lote
// (docs/10 §4.2 "Escritura en lote", O13).
//
// Por qué no una ADD_EMPLOYEE_TO_DEVICE por persona: cada una verifica por
// conteo (+1 usuario, +1 huella) suponiendo que nadie más escribe en el equipo a
// la vez, y cada una arranca con una sonda GET_USER_INFO — el comando que en
// producción deja al equipo mudo ~2 min cuando no contesta (O9). Con decenas de
// personas, los conteos se cruzan y las sondas suman horas.
//
// El lote, una sola operación que el candado por equipo corre sola (queue.ts):
//   1. baseline  — GET_DEVICE_STATUS: totales de partida.
//   2. users     — SET_USER_INFO de cada persona que NO está en la caché, seguidos.
//      Sin sonda (D2): quien tiene huellas ya está en la caché (la corrida recién
//      leyó la lista) y a un ID en caché nunca se le manda SET_USER_INFO. Lo peor
//      posible es pisar a un usuario SIN huellas que no conocíamos: no pierde
//      nada, y el conteo lo delata (+0 en vez de +1).
//   3. users_count — GET_DEVICE_STATUS: el total tiene que subir exactamente lo
//      enviado. Si cierra, todos creados de una. Si no, se relee solo a esos
//      (GET_USER_INFO, 25 s cada uno) y quien no conteste queda para la próxima.
//   4. fps       — SET_ENROLL_DATA de cada huella faltante, a slots libres, seguidos.
//   5. fps_count — GET_DEVICE_STATUS: el total de huellas sube exactamente lo
//      enviado → todas escritas. Si no, se relee a cada persona con huellas nuevas
//      y se registra solo lo que el equipo reporta.
// Los códigos de retorno de SET_USER_INFO / SET_ENROLL_DATA no se usan: el
// firmware responde OK sin escribir (docs/05, T9b). Solo cuentan los conteos o
// la relectura.
import { prisma, runAsync } from "@/lib/db";
import {
  MIN_TEMPLATE_BYTES,
  desiredFingerprintIdsMany,
  ensureEnrollmentLink,
  freeSlot,
  patchTemplateUserId,
  recordPropagatedSlot,
} from "@/lib/fingerprints";
import { upsertUserFromInfo, UserInfoResult } from "./persist";
import {
  BACKGROUND_PRIORITY,
  createOperation,
  finishOperation,
  queueCommandForOperation,
  setStage,
  OperationRow,
} from "./queue";
import { OPERATION_LABELS, truncateUserName } from "./kinds";

/** Personas por lote. Un lote corre entero antes de dejar pasar a lo que pida el panel. */
export function batchSize(): number {
  const n = Number(process.env.SYNC_BATCH_SIZE ?? 20);
  return Number.isInteger(n) && n >= 1 && n <= 200 ? n : 20;
}

export interface BatchMemberInput {
  employeeId: number;
  cedula: string;
  name: string;
}

interface BatchMember {
  employeeId: number;
  userId: string;
  userName: string;
  /** Ya estaba en el equipo (caché) → no se crea; solo se vincula y se completan huellas. */
  exists?: boolean;
  /** Creado o ya estaba, y confirmado. Solo a estos se les copian huellas. */
  confirmed?: boolean;
}

interface FpWrite {
  userId: string;
  fingerprintId: number;
  slot: number;
}

export interface AddBatchPlan {
  phase: "baseline" | "users" | "users_count" | "users_reread" | "fps_baseline" | "fps" | "fps_count" | "fps_reread";
  members: BatchMember[];
  /** Pendientes del paso en curso: user_ids (users / relecturas) o huellas (fps). */
  pendingUsers: string[];
  pendingFps: FpWrite[];
  current?: string;
  currentFp?: FpWrite;
  usersBefore?: number;
  fpBefore?: number;
  created: string[];
  sentFps: FpWrite[];
  confirmedFps: FpWrite[];
  unconfirmed: string[];
  failedFps: Array<FpWrite & { reason: string }>;
  /** Hubo que releer (algún conteo no cerró). */
  reread?: boolean;
}

interface AdvanceInputLike {
  ok: boolean;
  returnCode: string;
  resultJson: Record<string, any> | null;
  binaries: Buffer[];
}

function count(input: AdvanceInputLike, field: "total_user_count" | "fp_count"): number | null {
  if (!input.ok) return null;
  const n = Number(input.resultJson?.[field]);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Encola un lote. Devuelve el id de la operación. */
export async function startAddEmployeesBatch(
  devId: string,
  members: BatchMemberInput[],
  part: { index: number; total: number } = { index: 1, total: 1 }
): Promise<number> {
  const plan: AddBatchPlan = {
    phase: "baseline",
    members: members.map((m) => ({ employeeId: m.employeeId, userId: m.cedula, userName: truncateUserName(m.name) })),
    pendingUsers: [],
    pendingFps: [],
    created: [],
    sentFps: [],
    confirmedFps: [],
    unconfirmed: [],
    failedFps: [],
  };
  const of = part.total > 1 ? ` — lote ${part.index} de ${part.total}` : "";
  const id = await createOperation({
    kind: "ADD_EMPLOYEES_BATCH",
    label: `${OPERATION_LABELS.ADD_EMPLOYEES_BATCH}: ${members.length} persona(s)${of}`,
    devId,
    params: { employeeIds: members.map((m) => m.employeeId) },
    plan,
    stepTotal: 5,
    priority: BACKGROUND_PRIORITY,
  });
  await queueCommandForOperation(id, devId, "GET_DEVICE_STATUS", {});
  return id;
}

/** Empleados que ya tienen un alta en curso en este equipo (lote o individual): no se repiten. */
export async function employeesWithActiveAdd(devId: string): Promise<Set<number>> {
  const rows = await prisma.operations.findMany({
    where: {
      dev_id: devId,
      kind: { in: ["ADD_EMPLOYEES_BATCH", "ADD_EMPLOYEE_TO_DEVICE"] },
      stage: { in: ["queued", "sent", "waiting", "verifying"] },
    },
    select: { kind: true, user_id: true, params_json: true },
  });
  const out = new Set<number>();
  for (const r of rows) {
    if (r.kind === "ADD_EMPLOYEE_TO_DEVICE" && r.user_id?.startsWith("emp:")) out.add(Number(r.user_id.slice(4)));
    if (r.kind === "ADD_EMPLOYEES_BATCH" && r.params_json) {
      for (const id of (JSON.parse(r.params_json).employeeIds ?? []) as number[]) out.add(id);
    }
  }
  return out;
}

export async function advanceAddEmployeesBatch(op: OperationRow, input: AdvanceInputLike): Promise<void> {
  const plan: AddBatchPlan = JSON.parse(op.plan_json ?? "{}");

  switch (plan.phase) {
    case "baseline": {
      const users = count(input, "total_user_count");
      const fp = count(input, "fp_count");
      if (users === null || fp === null) {
        await finishOperation(op.id, "error", "No se pudo leer el estado del equipo; se reintenta en la próxima corrida.");
        return;
      }
      // Quién ya está: la caché (la corrida que lanzó este lote la acaba de cuadrar
      // con la lista del equipo). A un ID en caché nunca se le manda SET_USER_INFO:
      // sobre un usuario con huellas dispara el reindexado destructivo (docs/05).
      const cached = new Set(
        (
          await prisma.users.findMany({
            where: { dev_id: op.dev_id, user_id: { in: plan.members.map((m) => m.userId) } },
            select: { user_id: true },
          })
        ).map((u) => u.user_id)
      );
      const members = plan.members.map((m) => (cached.has(m.userId) ? { ...m, exists: true, confirmed: true } : m));
      for (const m of members) if (m.exists) await ensureEnrollmentLink(m.employeeId, op.dev_id, m.userId);
      const toCreate = members.filter((m) => !m.exists).map((m) => m.userId);
      const next: AddBatchPlan = { ...plan, members, usersBefore: users, fpBefore: fp };
      if (toCreate.length === 0) {
        await startFingerprints(op, next);
        return;
      }
      await sendNextUser(op, { ...next, phase: "users", pendingUsers: toCreate });
      return;
    }

    case "users": {
      // El OK de SET_USER_INFO no prueba nada: se verifica todo junto por conteo.
      await sendNextUser(op, plan);
      return;
    }

    case "users_count": {
      const users = count(input, "total_user_count");
      const fp = count(input, "fp_count");
      if (users !== null && plan.usersBefore !== undefined && users === plan.usersBefore + plan.created.length) {
        const createdSet = new Set(plan.created);
        const members = plan.members.map((m) => (createdSet.has(m.userId) ? { ...m, confirmed: true } : m));
        await cacheCreated(op.dev_id, members.filter((m) => createdSet.has(m.userId)));
        await startFingerprints(op, { ...plan, members, fpBefore: fp ?? undefined });
        return;
      }
      // No cierra (alguien ya existía sin huellas, otro cambio a la vez, o no se
      // leyó): se relee a cada creado. Quien conteste queda confirmado.
      await nextReread(op, { ...plan, phase: "users_reread", pendingUsers: [...plan.created], reread: true, fpBefore: undefined });
      return;
    }

    case "users_reread": {
      const userId = plan.current!;
      const members = [...plan.members];
      const unconfirmed = [...plan.unconfirmed];
      if (input.ok && input.resultJson?.user_name && String(input.resultJson.user_id ?? userId) === userId) {
        await upsertUserFromInfo(op.dev_id, input.resultJson as UserInfoResult, input.binaries);
        const i = members.findIndex((m) => m.userId === userId);
        if (i >= 0) {
          members[i] = { ...members[i], confirmed: true };
          await ensureEnrollmentLink(members[i].employeeId, op.dev_id, userId);
        }
      } else {
        unconfirmed.push(userId);
      }
      await nextReread(op, { ...plan, members, unconfirmed });
      return;
    }

    case "fps_baseline": {
      const fp = count(input, "fp_count");
      if (fp === null) {
        await finish(op, plan, "No se pudo leer el total de huellas del equipo; las huellas se copian en la próxima corrida.");
        return;
      }
      await startFingerprints(op, { ...plan, fpBefore: fp });
      return;
    }

    case "fps": {
      await sendNextFingerprint(op, plan);
      return;
    }

    case "fps_count": {
      const fp = count(input, "fp_count");
      if (fp !== null && plan.fpBefore !== undefined && fp === plan.fpBefore + plan.sentFps.length) {
        await recordFingerprints(op.dev_id, plan.sentFps);
        await finish(op, { ...plan, confirmedFps: plan.sentFps });
        return;
      }
      // No cierra: se relee a cada persona a la que se le escribió, y cuenta solo
      // el slot que el equipo reporta.
      const users = [...new Set(plan.sentFps.map((w) => w.userId))];
      await nextReread(op, { ...plan, phase: "fps_reread", pendingUsers: users, reread: true });
      return;
    }

    case "fps_reread": {
      const userId = plan.current!;
      const sent = plan.sentFps.filter((w) => w.userId === userId);
      const reported = new Set(
        input.ok && Array.isArray(input.resultJson?.enroll_data_array)
          ? (input.resultJson!.enroll_data_array as Array<{ backup_number: number }>).map((e) => Number(e.backup_number))
          : []
      );
      const ok = input.ok ? sent.filter((w) => reported.has(w.slot)) : [];
      const bad = sent.filter((w) => !ok.includes(w));
      await recordFingerprints(op.dev_id, ok);
      if (input.ok && input.resultJson?.user_name) await upsertUserFromInfo(op.dev_id, input.resultJson as UserInfoResult, input.binaries);
      await nextReread(op, {
        ...plan,
        confirmedFps: [...plan.confirmedFps, ...ok],
        failedFps: [
          ...plan.failedFps,
          ...bad.map((w) => ({ ...w, reason: input.ok ? `el equipo no la reporta en el slot ${w.slot}` : `sin respuesta (${input.returnCode})` })),
        ],
      });
      return;
    }
  }
}

async function sendNextUser(op: OperationRow, plan: AddBatchPlan): Promise<void> {
  const [next, ...rest] = plan.pendingUsers;
  if (next === undefined) {
    await setStage(op.id, "verifying", { plan: { ...plan, phase: "users_count", current: undefined }, stepIndex: 2 });
    await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
    return;
  }
  const member = plan.members.find((m) => m.userId === next)!;
  await setStage(op.id, "waiting", {
    plan: { ...plan, phase: "users", pendingUsers: rest, current: next, created: [...plan.created, next] },
    stepIndex: 1,
  });
  await queueCommandForOperation(op.id, op.dev_id, "SET_USER_INFO", {
    user_id: next,
    user_name: member.userName,
    user_privilege: "USER",
  });
}

/** GET_USER_INFO del siguiente pendiente de relectura, o sigue con la fase que corresponde. */
async function nextReread(op: OperationRow, plan: AddBatchPlan): Promise<void> {
  const [next, ...rest] = plan.pendingUsers;
  if (next !== undefined) {
    // 'verifying': si no contesta, expira en 25 s (no 3 min) y vuelve acá como fallo.
    await setStage(op.id, "verifying", { plan: { ...plan, pendingUsers: rest, current: next }, stepIndex: plan.phase === "users_reread" ? 2 : 4 });
    await queueCommandForOperation(op.id, op.dev_id, "GET_USER_INFO", { user_id: next });
    return;
  }
  if (plan.phase === "users_reread") {
    // Las relecturas no cambian los totales, pero el de huellas de la línea de base
    // quedó atrás de las creaciones: se vuelve a leer antes de copiar huellas.
    await setStage(op.id, "verifying", { plan: { ...plan, phase: "fps_baseline", current: undefined }, stepIndex: 3 });
    await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
    return;
  }
  await finish(op, plan);
}

/** Arma las escrituras de huellas (a slots libres) de los confirmados y arranca. */
async function startFingerprints(op: OperationRow, plan: AddBatchPlan): Promise<void> {
  if (plan.fpBefore === undefined) {
    await setStage(op.id, "verifying", { plan: { ...plan, phase: "fps_baseline", current: undefined }, stepIndex: 3 });
    await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
    return;
  }
  const ready = plan.members.filter((m) => m.confirmed);
  const desired = await desiredFingerprintIdsMany(ready.map((m) => m.employeeId));
  const slots = await prisma.device_fingerprint_slot.findMany({
    where: { dev_id: op.dev_id, device_user_id: { in: ready.map((m) => m.userId) } },
    select: { device_user_id: true, backup_number: true, fingerprint_id: true },
  });
  const writes: FpWrite[] = [];
  const failed: AddBatchPlan["failedFps"] = [];
  for (const m of ready) {
    const mine = slots.filter((s) => s.device_user_id === m.userId);
    const present = new Set(mine.map((s) => s.fingerprint_id));
    const used = mine.map((s) => s.backup_number);
    for (const fingerprintId of desired.get(m.employeeId)?.ids ?? []) {
      if (present.has(fingerprintId)) continue;
      const slot = freeSlot(used);
      if (slot === null) {
        failed.push({ userId: m.userId, fingerprintId, slot: -1, reason: "los 10 slots del usuario ya están ocupados en este equipo" });
        continue;
      }
      used.push(slot);
      writes.push({ userId: m.userId, fingerprintId, slot });
    }
  }
  const next: AddBatchPlan = { ...plan, failedFps: [...plan.failedFps, ...failed] };
  if (writes.length === 0) {
    await finish(op, next);
    return;
  }
  await sendNextFingerprint(op, { ...next, phase: "fps", pendingFps: writes });
}

async function sendNextFingerprint(op: OperationRow, plan: AddBatchPlan): Promise<void> {
  for (let [next, ...rest] = plan.pendingFps; next !== undefined; [next, ...rest] = rest) {
    const fp = await prisma.employee_fingerprint.findUnique({ where: { id: next.fingerprintId }, select: { template: true } });
    if (!fp || fp.template.length < MIN_TEMPLATE_BYTES) {
      plan = { ...plan, pendingFps: rest, failedFps: [...plan.failedFps, { ...next, reason: "plantilla local inválida o ausente" }] };
      continue;
    }
    await setStage(op.id, "waiting", {
      plan: { ...plan, phase: "fps", pendingFps: rest, currentFp: next, sentFps: [...plan.sentFps, next] },
      stepIndex: 3,
    });
    await queueCommandForOperation(
      op.id,
      op.dev_id,
      "SET_ENROLL_DATA",
      { user_id: next.userId, backup_number: next.slot, enroll_data: "BIN_1" },
      patchTemplateUserId(fp.template, next.userId)
    );
    return;
  }
  if (plan.sentFps.length === 0) {
    await finish(op, plan);
    return;
  }
  await setStage(op.id, "verifying", { plan: { ...plan, phase: "fps_count", pendingFps: [], currentFp: undefined }, stepIndex: 4 });
  await queueCommandForOperation(op.id, op.dev_id, "GET_DEVICE_STATUS", {});
}

/** Caché + vínculo de los creados confirmados por conteo (lo que antes dejaba la relectura). */
async function cacheCreated(devId: string, members: BatchMember[]): Promise<void> {
  if (members.length === 0) return;
  await runAsync(
    `INSERT INTO users (dev_id, user_id, user_name, user_privilege)
     VALUES ${members.map(() => "(?, ?, ?, 'USER')").join(", ")}
     ON CONFLICT(dev_id, user_id) DO UPDATE SET user_name = excluded.user_name`,
    members.flatMap((m) => [devId, m.userId, m.userName])
  );
  for (const m of members) await ensureEnrollmentLink(m.employeeId, devId, m.userId);
}

/** Registro de procedencia + caché de plantillas de las huellas confirmadas. */
async function recordFingerprints(devId: string, writes: FpWrite[]): Promise<void> {
  if (writes.length === 0) return;
  for (const w of writes) await recordPropagatedSlot(devId, w.userId, w.slot, w.fingerprintId);
  const templates = new Map(
    (
      await prisma.employee_fingerprint.findMany({
        where: { id: { in: writes.map((w) => w.fingerprintId) } },
        select: { id: true, template: true },
      })
    ).map((f) => [f.id, f.template])
  );
  const rows = writes.filter((w) => templates.has(w.fingerprintId));
  if (rows.length === 0) return;
  await runAsync(
    `INSERT INTO enroll_data (dev_id, user_id, backup_number, data)
     VALUES ${rows.map(() => "(?, ?, ?, ?)").join(", ")}
     ON CONFLICT(dev_id, user_id, backup_number) DO UPDATE SET data = excluded.data`,
    rows.flatMap((w) => [devId, w.userId, w.slot, patchTemplateUserId(templates.get(w.fingerprintId)!, w.userId)])
  );
}

async function finish(op: OperationRow, plan: AddBatchPlan, extra?: string): Promise<void> {
  const created = plan.members.filter((m) => !m.exists && m.confirmed).length;
  const linked = plan.members.filter((m) => m.exists).length;
  const total = plan.confirmedFps.length + plan.failedFps.length;
  const parts = [
    created && `${created} creada(s)`,
    linked && `${linked} ya estaban (vinculadas)`,
    total && `${plan.confirmedFps.length} de ${total} huella(s) copiadas`,
    plan.unconfirmed.length && `${plan.unconfirmed.length} sin confirmar (se reintenta en la próxima corrida): ${plan.unconfirmed.join(", ")}`,
    plan.failedFps.length && `fallaron: ${[...new Set(plan.failedFps.map((f) => `${f.userId} (${f.reason})`))].join("; ")}`,
    plan.reread ? "verificado releyendo (los totales no cerraron)" : "verificado por los totales del equipo",
    extra,
  ].filter(Boolean);
  const clean = plan.unconfirmed.length === 0 && plan.failedFps.length === 0 && !extra;
  await finishOperation(op.id, clean ? "done" : "mismatch", `${parts.join(" · ")}.`);
}
