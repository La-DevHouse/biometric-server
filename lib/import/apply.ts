// Aplicar un plan de importación a una empresa (docs/14): una sola transacción.
// Puestos y departamentos nuevos y sus alias → personas nuevas → contratos →
// departamento de cada puesto. Las altas masivas van con createManyAndReturn;
// cada alta o cambio deja su fila en audit_log.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normKey, ymdToDate } from "./normalize";
import type { CategoryOp, CompanyImportPlan } from "./plan";

/** El timeout por defecto de Prisma (5 s) no alcanza para miles de filas. */
const TX_TIMEOUT_MS = 180_000;

export interface ApplyResult {
  employeesCreated: number;
  employeesUpdated: number;
  contractsCreated: number;
  contractsUpdated: number;
  positionsCreated: number;
  departmentsCreated: number;
  /** Puestos que quedaron en otro departamento. */
  positionsMoved: number;
  aliasesSaved: number;
}

type Log = (action: string, entityType: string, entityId: number, before: unknown, after: unknown) => void;

/**
 * Crea los nuevos (uno por nombre: dos renombrados igual son uno solo), recuerda
 * como alias cada texto del archivo que terminó en otro nombre ("HORMERO" →
 * Hornero) y devuelve clave del archivo → id.
 */
async function resolveIds(
  ops: CategoryOp[],
  entity: "position" | "department",
  create: (names: string[]) => Promise<Array<{ id: number; name: string }>>,
  saveAlias: (key: string, text: string, id: number) => Promise<unknown>,
  log: Log
): Promise<{ ids: Map<string, number>; created: number; aliases: number }> {
  const newNames = new Map<string, string>();
  for (const c of ops) if (c.resolution.kind === "new") newNames.set(normKey(c.resolution.name), c.resolution.name);
  const createdByKey = new Map<string, number>();
  if (newNames.size) {
    for (const row of await create([...newNames.values()])) {
      createdByKey.set(normKey(row.name), row.id);
      log(`import.${entity}.create`, entity, row.id, undefined, row);
    }
  }
  const byKey = new Map(ops.map((c) => [c.key, c]));
  const idOf = (key: string): number => {
    const r = byKey.get(key)!.resolution;
    if (r.kind === "new") return createdByKey.get(normKey(r.name))!;
    if (r.kind === "same") return idOf(r.into);
    return r.id;
  };
  const ids = new Map(ops.map((c) => [c.key, idOf(c.key)]));

  let aliases = 0;
  for (const c of ops) {
    if (c.resolution.kind === "existing" || c.resolution.kind === "alias") continue;
    const finalName = c.resolution.kind === "same" ? byKey.get(c.resolution.into)!.resolution.name : c.resolution.name;
    if (normKey(finalName) === c.key) continue;
    await saveAlias(c.key, c.text, ids.get(c.key)!);
    aliases++;
    log(`import.${entity}_alias.save`, entity, ids.get(c.key)!, undefined, { alias: c.text });
  }
  return { ids, created: newNames.size, aliases };
}

export async function applyPlan(plan: CompanyImportPlan, actorId: number | null, runId: number): Promise<ApplyResult> {
  if (!plan.ok) throw new Error("El archivo tiene filas rechazadas: no se aplica nada.");
  const audit: Prisma.audit_logCreateManyInput[] = [];
  const log: Log = (action, entityType, entityId, before, after) =>
    audit.push({
      actor_app_user_id: actorId,
      action,
      entity_type: entityType,
      entity_id: String(entityId),
      before_json: before === undefined ? Prisma.JsonNull : (before as Prisma.InputJsonValue),
      after_json: { ...(after as object), import_run_id: runId } as Prisma.InputJsonValue,
    });

  return prisma.$transaction(
    async (tx) => {
      const company = await tx.client_company.findUniqueOrThrow({ where: { id: plan.companyId }, select: { id: true, business_model_id: true } });

      // --- Cargos → puestos, departamentos ---
      const positions = await resolveIds(
        plan.cargos,
        "position",
        (names) => tx.position.createManyAndReturn({ data: names.map((name) => ({ name })), select: { id: true, name: true } }),
        (alias_key, alias, position_id) =>
          tx.position_alias.upsert({ where: { alias_key }, create: { alias_key, alias, position_id }, update: { alias, position_id } }),
        log
      );
      const departments = await resolveIds(
        plan.departments,
        "department",
        (names) => tx.department.createManyAndReturn({ data: names.map((name) => ({ name })), select: { id: true, name: true } }),
        (alias_key, alias, department_id) =>
          tx.department_alias.upsert({ where: { alias_key }, create: { alias_key, alias, department_id }, update: { alias, department_id } }),
        log
      );
      const positionOf = (p: { cargoKey: string | null }) => (p.cargoKey ? (positions.ids.get(p.cargoKey) ?? null) : null);
      const departmentOf = (p: { deptKey: string | null }) => (p.deptKey ? (departments.ids.get(p.deptKey) ?? null) : null);

      // Puestos usados en una empresa con modelo de negocio: asociados a ese modelo,
      // igual que "crear puesto nuevo" del formulario de contrato.
      if (company.business_model_id) {
        const used = [...new Set(plan.people.map(positionOf).filter((x): x is number => x !== null))];
        if (used.length) {
          await tx.position_business_model.createMany({
            data: used.map((position_id) => ({ position_id, business_model_id: company.business_model_id! })),
            skipDuplicates: true,
          });
        }
      }

      // Cada puesto queda en el departamento en el que está en el archivo (aunque
      // tuviera otro: decisión de ALCO, docs/14). Si el archivo lo pone en más de
      // uno, no hay cuál elegir: no se toca.
      const deptsByPosition = new Map<number, Set<number>>();
      for (const p of plan.people) {
        const pos = positionOf(p);
        const dep = departmentOf(p);
        if (pos === null || dep === null) continue;
        deptsByPosition.set(pos, (deptsByPosition.get(pos) ?? new Set()).add(dep));
      }
      let positionsMoved = 0;
      if (deptsByPosition.size) {
        const current = await tx.position.findMany({ where: { id: { in: [...deptsByPosition.keys()] } }, select: { id: true, department_id: true } });
        for (const pos of current) {
          const deps = deptsByPosition.get(pos.id)!;
          if (deps.size !== 1) continue;
          const [dep] = deps;
          if (pos.department_id === dep) continue;
          await tx.position.update({ where: { id: pos.id }, data: { department_id: dep } });
          log("import.position.update", "position", pos.id, { department_id: pos.department_id }, { department_id: dep });
          positionsMoved++;
        }
      }

      // --- Personas ---
      const employeeByCedula = new Map<string, number>();
      for (const p of plan.people) if (p.employeeId) employeeByCedula.set(p.cedula, p.employeeId);
      const newPeople = plan.people.filter((p) => p.employee === "create");
      if (newPeople.length) {
        const created = await tx.employee.createManyAndReturn({
          data: newPeople.map((p) => ({
            national_id: p.cedula,
            tax_id: p.cedula,
            first_name: p.firstName,
            last_name: p.lastName,
            birth_date: p.birthDate ? ymdToDate(p.birthDate) : null,
          })),
          select: { id: true, national_id: true, first_name: true, last_name: true, birth_date: true },
        });
        for (const e of created) {
          employeeByCedula.set(e.national_id, e.id);
          log("import.employee.create", "employee", e.id, undefined, e);
        }
      }
      const updatedPeople = plan.people.filter((p) => p.personChanges.length > 0);
      for (const p of updatedPeople) {
        await tx.employee.update({ where: { id: p.employeeId! }, data: { birth_date: ymdToDate(p.birthDate!) } });
        log(
          "import.employee.update", "employee", p.employeeId!,
          Object.fromEntries(p.personChanges.map((c) => [c.field, c.from])),
          Object.fromEntries(p.personChanges.map((c) => [c.field, c.to]))
        );
      }

      // --- Contratos ---
      const newContracts = plan.people.filter((p) => p.contract === "create");
      if (newContracts.length) {
        const created = await tx.employment.createManyAndReturn({
          data: newContracts.map((p) => ({
            employee_id: employeeByCedula.get(p.cedula)!,
            company_id: company.id,
            start_date: ymdToDate(p.startDate),
            position_id: positionOf(p),
            department_id: departmentOf(p),
          })),
          select: { id: true, employee_id: true, company_id: true, start_date: true, position_id: true, department_id: true },
        });
        for (const c of created) log("import.employment.create", "employment", c.id, undefined, c);
      }
      const updates = plan.people.filter((p) => p.contract === "update");
      for (const p of updates) {
        const fields = new Set(p.changes.map((c) => c.field));
        await tx.employment.update({
          where: { id: p.contractId! },
          data: {
            ...(fields.has("Puesto") ? { position_id: positionOf(p) } : {}),
            ...(fields.has("Departamento") ? { department_id: departmentOf(p) } : {}),
          },
        });
        log(
          "import.employment.update", "employment", p.contractId!,
          Object.fromEntries(p.changes.map((c) => [c.field, c.from])),
          Object.fromEntries(p.changes.map((c) => [c.field, c.to]))
        );
      }

      if (audit.length) await tx.audit_log.createMany({ data: audit });
      return {
        employeesCreated: newPeople.length,
        employeesUpdated: updatedPeople.length,
        contractsCreated: newContracts.length,
        contractsUpdated: updates.length,
        positionsCreated: positions.created,
        departmentsCreated: departments.created,
        positionsMoved,
        aliasesSaved: positions.aliases + departments.aliases,
      };
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 10_000 }
  );
}
