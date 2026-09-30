// Aplicar un plan de importación a una empresa (docs/14): una sola transacción.
// Puestos nuevos y alias → personas nuevas → contratos. Las altas masivas van con
// createManyAndReturn; cada alta o cambio deja su fila en audit_log.
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normKey, ymdToDate } from "./normalize";
import type { CompanyImportPlan } from "./plan";

/** El timeout por defecto de Prisma (5 s) no alcanza para miles de filas. */
const TX_TIMEOUT_MS = 180_000;

export interface ApplyResult {
  employeesCreated: number;
  employeesUpdated: number;
  contractsCreated: number;
  contractsUpdated: number;
  positionsCreated: number;
  aliasesSaved: number;
}

export async function applyPlan(plan: CompanyImportPlan, actorId: number | null, runId: number): Promise<ApplyResult> {
  if (!plan.ok) throw new Error("El archivo tiene filas rechazadas: no se aplica nada.");
  const audit: Prisma.audit_logCreateManyInput[] = [];
  const log = (action: string, entityType: string, entityId: number, before: unknown, after: unknown) =>
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

      // --- Cargos → puestos ---
      // Puestos nuevos: uno por nombre (dos cargos renombrados igual son uno solo).
      const newNames = new Map<string, string>();
      for (const c of plan.cargos) if (c.resolution.kind === "new") newNames.set(normKey(c.resolution.name), c.resolution.name);
      const createdByKey = new Map<string, number>();
      if (newNames.size) {
        const created = await tx.position.createManyAndReturn({
          data: [...newNames.values()].map((name) => ({ name })),
          select: { id: true, name: true },
        });
        for (const p of created) {
          createdByKey.set(normKey(p.name), p.id);
          log("import.position.create", "position", p.id, undefined, p);
        }
      }
      const byKey = new Map(plan.cargos.map((c) => [c.key, c]));
      const positionOf = (key: string): number => {
        const r = byKey.get(key)!.resolution;
        if (r.kind === "new") return createdByKey.get(normKey(r.name))!;
        if (r.kind === "same") return positionOf(r.into);
        return r.positionId;
      };
      const positionByCargo = new Map(plan.cargos.map((c) => [c.key, positionOf(c.key)]));

      // Se recuerda cómo se resolvió cada cargo cuyo texto no es el nombre del puesto
      // ("HORMERO" → Hornero, "DESPACHADORA" → Despachador), para los próximos archivos.
      let aliasesSaved = 0;
      for (const c of plan.cargos) {
        if (c.resolution.kind === "position" || c.resolution.kind === "alias") continue;
        const positionId = positionByCargo.get(c.key)!;
        const finalName = c.resolution.kind === "same" ? byKey.get(c.resolution.into)!.resolution.name : c.resolution.name;
        if (normKey(finalName) === c.key) continue;
        await tx.position_alias.upsert({
          where: { alias_key: c.key },
          create: { alias_key: c.key, alias: c.text, position_id: positionId },
          update: { alias: c.text, position_id: positionId },
        });
        aliasesSaved++;
        log("import.position_alias.save", "position", positionId, undefined, { alias: c.text });
      }
      // Puestos usados en una empresa con modelo de negocio: asociados a ese modelo,
      // igual que "crear puesto nuevo" del formulario de contrato.
      if (company.business_model_id) {
        const used = [...new Set(plan.people.map((p) => (p.cargoKey ? positionByCargo.get(p.cargoKey) : undefined)).filter((x): x is number => x !== undefined))];
        if (used.length) {
          await tx.position_business_model.createMany({
            data: used.map((position_id) => ({ position_id, business_model_id: company.business_model_id! })),
            skipDuplicates: true,
          });
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
            position_id: p.cargoKey ? (positionByCargo.get(p.cargoKey) ?? null) : null,
          })),
          select: { id: true, employee_id: true, company_id: true, start_date: true, position_id: true },
        });
        for (const c of created) log("import.employment.create", "employment", c.id, undefined, c);
      }
      const updates = plan.people.filter((p) => p.contract === "update");
      for (const p of updates) {
        await tx.employment.update({ where: { id: p.contractId! }, data: { position_id: positionByCargo.get(p.cargoKey!)! } });
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
        positionsCreated: newNames.size,
        aliasesSaved,
      };
    },
    { timeout: TX_TIMEOUT_MS, maxWait: 10_000 }
  );
}
