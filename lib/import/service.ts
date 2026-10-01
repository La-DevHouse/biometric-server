// Vista previa y confirmación de la importación de trabajadores a una empresa
// (docs/14). El archivo se guarda en import_run entre los dos pasos. "Confirmar"
// recalcula el plan: si cambió algo en la base desde la vista previa, devuelve la
// vista nueva en vez de aplicar; si no, aplica con los ajustes de la vista previa
// (corte de nombres, puesto de cada cargo).
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { devicesAffectedByCompany, triggerReconcile } from "@/lib/sync/reconcile";
import { applyPlan, type ApplyResult } from "./apply";
import { buildPlan, loadSnapshot, type CategoryOp, type CompanyImportPlan, type Overrides, type PersonOp, type Rejection } from "./plan";
import { readGalepso } from "./read";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** Personas que viajan a la pantalla (las dudosas primero); el resto se resume. */
const VIEW_LIMIT = 1000;
const RETENTION_DAYS = 30;

export type PreviewPerson = Pick<
  PersonOp,
  "row" | "cedula" | "employee" | "firstName" | "lastName" | "split" | "fileName" | "birthDate" | "personChanges" | "contract" | "startDate" | "cargoKey" | "deptKey" | "changes"
>;

export interface PreviewView {
  runId: number;
  companyId: number;
  companyName: string;
  fileName: string;
  ok: boolean;
  warnings: string[];
  rejected: Rejection[];
  counts: {
    people: number;
    newPeople: number;
    existingPeople: number;
    updatedPeople: number;
    newContracts: number;
    updatedContracts: number;
    sameContracts: number;
    ambiguous: number;
  };
  people: PreviewPerson[];
  peopleTotal: number;
  cargos: CategoryOp[];
  departments: CategoryOp[];
  /** Puestos existentes (con su departamento de hoy), para asignar un cargo a uno de ellos. */
  positions: Array<{ id: number; name: string; departmentId: number | null }>;
  /** Departamentos existentes, para asignar uno del archivo. */
  existingDepartments: Array<{ id: number; name: string }>;
  absent: Array<{ cedula: string; name: string }>;
  devices: { devices: number; peopleIn: number };
}

async function computePlan(companyId: number, file: Buffer, overrides: Overrides = {}): Promise<CompanyImportPlan> {
  const read = await readGalepso(file);
  const snap = await loadSnapshot(companyId, read);
  return buildPlan(companyId, read, snap, overrides);
}

/** Huella del plan SIN ajustes: si cambia entre la vista previa y confirmar, algo cambió en la base. */
function planHash(plan: CompanyImportPlan): string {
  return createHash("sha256")
    .update(JSON.stringify([plan.people.map((p) => ({ ...p, row: undefined })), plan.cargos, plan.departments, plan.rejected, plan.ok]))
    .digest("hex");
}

async function buildView(runId: number, fileName: string, plan: CompanyImportPlan): Promise<PreviewView> {
  const [company, positions, existingDepartments] = await Promise.all([
    prisma.client_company.findUnique({ where: { id: plan.companyId }, select: { name: true } }),
    prisma.position.findMany({ where: { status: "active" }, select: { id: true, name: true, department_id: true }, orderBy: { name: "asc" } }),
    prisma.department.findMany({ where: { status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const peopleIn = plan.people.filter((p) => p.contract === "create" && p.startDate <= today).length;
  const devices = peopleIn > 0 ? (await devicesAffectedByCompany(plan.companyId)).length : 0;
  const sorted = [...plan.people].sort((a, b) => Number(!!b.split?.ambiguous) - Number(!!a.split?.ambiguous) || a.row - b.row);
  return {
    runId,
    companyId: plan.companyId,
    companyName: company?.name ?? "",
    fileName,
    ok: plan.ok,
    warnings: plan.warnings,
    rejected: plan.rejected,
    counts: {
      people: plan.people.length,
      newPeople: plan.people.filter((p) => p.employee === "create").length,
      existingPeople: plan.people.filter((p) => p.employee === "existing").length,
      updatedPeople: plan.people.filter((p) => p.personChanges.length > 0).length,
      newContracts: plan.people.filter((p) => p.contract === "create").length,
      updatedContracts: plan.people.filter((p) => p.contract === "update").length,
      sameContracts: plan.people.filter((p) => p.contract === "same").length,
      ambiguous: plan.people.filter((p) => p.split?.ambiguous).length,
    },
    people: sorted
      .slice(0, VIEW_LIMIT)
      .map(({ row, cedula, employee, firstName, lastName, split, fileName: fn, birthDate, personChanges, contract, startDate, cargoKey, deptKey, changes }) => ({
        row, cedula, employee, firstName, lastName, split, fileName: fn, birthDate, personChanges, contract, startDate, cargoKey, deptKey, changes,
      })),
    peopleTotal: plan.people.length,
    cargos: plan.cargos,
    departments: plan.departments,
    positions: positions.map((p) => ({ id: p.id, name: p.name, departmentId: p.department_id })),
    existingDepartments,
    absent: plan.absent,
    devices: { devices, peopleIn },
  };
}

/** Borra los archivos guardados de más de 30 días (sin cron: corre en cada subida). */
async function purgeOldFiles(): Promise<void> {
  await prisma.$executeRaw`
    UPDATE import_run
       SET file = NULL,
           status = CASE WHEN status = 'preview' THEN 'expired' ELSE status END
     WHERE file IS NOT NULL AND created_at < now() - make_interval(days => ${RETENTION_DAYS})`;
}

export async function previewCompanyImport(companyId: number, file: Buffer, fileName: string, actorId: number | null): Promise<PreviewView> {
  await purgeOldFiles();
  const plan = await computePlan(companyId, file);
  const run = await prisma.import_run.create({
    data: {
      actor_app_user_id: actorId,
      company_id: companyId,
      file_name: fileName,
      file_hash: createHash("sha256").update(file).digest("hex"),
      file: new Uint8Array(file),
      plan_hash: planHash(plan),
    },
    select: { id: true },
  });
  const view = await buildView(run.id, fileName, plan);
  await prisma.import_run.update({ where: { id: run.id }, data: { summary: summaryOf(view) } });
  return view;
}

/**
 * Retomar una importación que quedó sin confirmar (historial → "Continuar"): se
 * recalcula la vista previa con el archivo guardado, contra la base de hoy.
 */
export async function reopenCompanyImport(runId: number, companyId: number): Promise<PreviewView> {
  const run = await prisma.import_run.findUnique({ where: { id: runId } });
  if (!run || run.company_id !== companyId) throw new Error("Esa importación no existe en esta empresa.");
  if (run.status === "applied") throw new Error("Esa importación ya se aplicó.");
  if (run.status !== "preview" || !run.file) throw new Error("Esa vista previa venció (el archivo se guarda 30 días). Volvé a subir el archivo.");
  const plan = await computePlan(companyId, Buffer.from(run.file));
  const view = await buildView(run.id, run.file_name, plan);
  await prisma.import_run.update({ where: { id: run.id }, data: { plan_hash: planHash(plan), summary: summaryOf(view) } });
  return view;
}

export type ConfirmResult =
  | { status: "applied"; result: ApplyResult; message: string }
  | { status: "changed"; view: PreviewView; message: string };

export async function confirmCompanyImport(runId: number, actorId: number | null, overrides: Overrides = {}): Promise<ConfirmResult> {
  const run = await prisma.import_run.findUnique({ where: { id: runId } });
  if (!run || run.company_id == null) throw new Error("Esa importación no existe.");
  if (run.status === "applied") throw new Error("Esa importación ya se aplicó.");
  if (run.status !== "preview" || !run.file) throw new Error("La vista previa venció. Volvé a subir el archivo.");
  if ((run.summary as { ok?: boolean } | null)?.ok === false) {
    throw new Error("El archivo tiene filas rechazadas: corregilas en el Excel y volvé a subirlo (no se aplicó nada).");
  }

  // Tomarla de forma atómica: un doble clic o dos pestañas no la aplican dos veces.
  const claimed = await prisma.import_run.updateMany({ where: { id: runId, status: "preview" }, data: { status: "applied" } });
  if (claimed.count === 0) throw new Error("Esa importación ya se está aplicando o ya se aplicó.");

  const file = Buffer.from(run.file);
  let plan: CompanyImportPlan;
  try {
    const base = await computePlan(run.company_id, file);
    if (planHash(base) !== run.plan_hash || !base.ok) {
      const view = await buildView(run.id, run.file_name, base);
      await prisma.import_run.update({ where: { id: run.id }, data: { status: "preview", plan_hash: planHash(base), summary: summaryOf(view) } });
      return { status: "changed", view, message: "Algo cambió en el sistema desde la vista previa. Revisá la vista previa actualizada y confirmá de nuevo." };
    }
    plan = await computePlan(run.company_id, file, overrides);
    if (!plan.ok) throw new Error("Los ajustes de la vista previa dejaron filas inválidas. Volvé a subir el archivo.");
  } catch (e) {
    await prisma.import_run.update({ where: { id: run.id }, data: { status: "preview" } });
    throw e;
  }

  let result: ApplyResult;
  try {
    result = await applyPlan(plan, actorId, run.id);
  } catch (e) {
    await prisma.import_run.update({ where: { id: run.id }, data: { status: "failed", summary: { ...(run.summary as object), error: String(e) } } });
    throw e;
  }
  await prisma.import_run.update({
    where: { id: run.id },
    data: { applied_at: new Date(), summary: { ...(run.summary as object), overrides: overrides as object, result: result as unknown as object } },
  });

  // Después del commit: una corrida por equipo de la empresa, no una por persona.
  let synced = 0;
  try {
    synced = (await triggerReconcile(await devicesAffectedByCompany(run.company_id), "event", actorId ?? undefined)).length;
  } catch (e) {
    console.error("[import] no se pudo disparar la sincronización:", e);
  }
  const parts = [
    `${result.employeesCreated} persona(s) nueva(s)`,
    `${result.contractsCreated} contrato(s) nuevo(s)`,
    result.employeesUpdated && `${result.employeesUpdated} fecha(s) de nacimiento actualizada(s)`,
    result.contractsUpdated && `${result.contractsUpdated} contrato(s) actualizado(s)`,
    result.positionsCreated && `${result.positionsCreated} puesto(s) creado(s)`,
    result.departmentsCreated && `${result.departmentsCreated} departamento(s) creado(s)`,
    result.positionsMoved && `${result.positionsMoved} puesto(s) asignado(s) a su departamento`,
  ].filter(Boolean);
  return { status: "applied", result, message: `Importación aplicada: ${parts.join(" · ")}.${synced ? ` Sincronizando ${synced} equipo(s).` : ""}` };
}

function summaryOf(view: PreviewView) {
  return {
    ok: view.ok,
    rejected: view.rejected.length,
    counts: view.counts,
    cargos: view.cargos.length,
    departments: view.departments.length,
    absent: view.absent.length,
    devices: view.devices,
  };
}
