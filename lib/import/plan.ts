// Plan de importación de trabajadores a UNA empresa (docs/14): qué personas se
// crean, qué contratos se crean o cambian, qué se rechaza. `loadSnapshot` trae de
// la base lo necesario EN LOTE; `buildPlan` es puro sobre ese snapshot.
//
// Reglas (docs/14 §7):
//   D1 — con una sola fila rechazada no se aplica nada.
//   D2 — un dato vacío no borra nada. A una persona que ya existe no se le cambia
//        el nombre (el del sistema puede venir de escanear su cédula; el del
//        archivo es una sola celda partida por heurística): si difiere, se avisa.
//   D3 — no se da de baja a nadie: los que tienen contrato vigente y no están en
//        el archivo solo se listan.
//   Cargo → puesto: el que ya existe con ese nombre, o el asignado antes (alias),
//        o el que se elija en la vista previa, o uno nuevo.
import { prisma } from "@/lib/db";
import { activeEmploymentWhere } from "@/lib/scope";
import { splitFullName } from "./names";
import { cellText, cleanText, dateToYmd, isBlank, normKey, parseCedula, parseDate } from "./normalize";
import type { ReadResult } from "./read";

export interface Change {
  field: string;
  from: string | null;
  to: string | null;
}

export interface Rejection {
  row: number | null;
  column: string | null;
  message: string;
}

/** Ajustes que se hacen en la vista previa. */
export interface Overrides {
  /** cédula → cuántas palabras son nombres. */
  splits?: Record<string, number>;
  /** clave del cargo → qué hacer con él. */
  cargos?: Record<string, CargoChoice>;
}

/**
 * Qué hacer con un cargo del archivo (vista previa):
 *  - new: crear un puesto, con el nombre dado (por defecto el del archivo);
 *  - position: usar un puesto que ya existe;
 *  - same: lo mismo que otro cargo de este archivo (unificar "HORMERO" con "HORNERO").
 */
export type CargoChoice = { kind: "new"; name?: string } | { kind: "position"; id: number } | { kind: "same"; key: string };

export interface PersonOp {
  row: number;
  cedula: string;
  employee: "create" | "existing";
  employeeId?: number;
  firstName: string;
  lastName: string;
  /** Solo para las personas nuevas: el corte de nombres y si es dudoso. */
  split?: { tokens: string[]; boundary: number; ambiguous: boolean };
  /** Persona existente cuyo nombre en el archivo es distinto al del sistema. */
  fileName?: string;
  contract: "create" | "update" | "same";
  contractId?: number;
  startDate: string;
  cargoKey: string | null;
  changes: Change[];
}

export type CargoResolution =
  | { kind: "position"; positionId: number; name: string }
  | { kind: "alias"; positionId: number; name: string }
  | { kind: "mapped"; positionId: number; name: string }
  | { kind: "new"; name: string }
  /** Unificado con otro cargo del archivo: termina en el mismo puesto que ese. */
  | { kind: "same"; into: string; name: string };

export interface CargoOp {
  key: string;
  text: string;
  count: number;
  resolution: CargoResolution;
}

export interface CompanyImportPlan {
  companyId: number;
  people: PersonOp[];
  cargos: CargoOp[];
  absent: Array<{ cedula: string; name: string }>;
  rejected: Rejection[];
  warnings: string[];
  ok: boolean;
}

interface Named {
  id: number;
  name: string;
}

export interface Snapshot {
  company: { id: number; name: string; status: string; business_model_id: number | null } | null;
  employeesByCedula: Map<string, { id: number; first_name: string; last_name: string }>;
  /** Contratos de esas personas EN ESTA EMPRESA. */
  contractsByEmployee: Map<number, Array<{ id: number; start_date: string; end_date: string | null; status: string; position_id: number | null }>>;
  positionsByKey: Map<string, Named>;
  positionsById: Map<number, string>;
  aliases: Map<string, Named>;
  activeInCompany: Array<{ cedula: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Snapshot (lectura en lote)
// ---------------------------------------------------------------------------

export async function loadSnapshot(companyId: number, read: ReadResult): Promise<Snapshot> {
  const cedulas = new Set<string>();
  for (const r of read.rows) {
    const c = parseCedula(r.cells.cedula);
    if ("value" in c) cedulas.add(c.value);
  }
  const [company, employees, positions, aliases, active] = await Promise.all([
    prisma.client_company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true, business_model_id: true } }),
    prisma.employee.findMany({ where: { national_id: { in: [...cedulas] } }, select: { id: true, national_id: true, first_name: true, last_name: true } }),
    prisma.position.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.position_alias.findMany({ select: { alias_key: true, position: { select: { id: true, name: true } } } }),
    prisma.employment.findMany({
      where: { company_id: companyId, ...activeEmploymentWhere() },
      select: { employee: { select: { national_id: true, first_name: true, last_name: true } } },
    }),
  ]);
  const contracts = await prisma.employment.findMany({
    where: { company_id: companyId, employee_id: { in: employees.map((e) => e.id) } },
    select: { id: true, employee_id: true, start_date: true, end_date: true, status: true, position_id: true },
  });

  const positionsByKey = new Map<string, Named>();
  for (const p of positions) if (!positionsByKey.has(normKey(p.name))) positionsByKey.set(normKey(p.name), p);
  const contractsByEmployee = new Map<number, Snapshot["contractsByEmployee"] extends Map<number, infer V> ? V : never>();
  for (const c of contracts) {
    const list = contractsByEmployee.get(c.employee_id) ?? [];
    list.push({ id: c.id, start_date: dateToYmd(c.start_date)!, end_date: dateToYmd(c.end_date), status: c.status, position_id: c.position_id });
    contractsByEmployee.set(c.employee_id, list);
  }
  return {
    company,
    employeesByCedula: new Map(employees.map((e) => [e.national_id, { id: e.id, first_name: e.first_name, last_name: e.last_name }])),
    contractsByEmployee,
    positionsByKey,
    positionsById: new Map(positions.map((p) => [p.id, p.name])),
    aliases: new Map(aliases.map((a) => [a.alias_key, a.position])),
    activeInCompany: active.map((a) => ({ cedula: a.employee.national_id, name: `${a.employee.first_name} ${a.employee.last_name}` })),
  };
}

// ---------------------------------------------------------------------------
// Plan (puro)
// ---------------------------------------------------------------------------

/** "DESPACHADORA" → "Despachadora"; si ya viene con mayúsculas y minúsculas, se respeta. */
export function cleanCargo(raw: unknown): string {
  const t = cleanText(raw);
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

export function buildPlan(companyId: number, read: ReadResult, snap: Snapshot, overrides: Overrides = {}): CompanyImportPlan {
  const rejected: Rejection[] = read.errors.map((message) => ({ row: null, column: null, message }));
  const reject = (row: number, column: string | null, message: string) => rejected.push({ row, column, message });

  if (!snap.company) rejected.push({ row: null, column: null, message: "La empresa no existe." });
  else if (snap.company.status !== "active") rejected.push({ row: null, column: null, message: "La empresa está inactiva: reactivala antes de importar." });

  // Cédulas repetidas dentro del archivo.
  const rowsByCedula = new Map<string, number[]>();
  for (const r of read.rows) {
    const c = parseCedula(r.cells.cedula);
    if ("value" in c) rowsByCedula.set(c.value, [...(rowsByCedula.get(c.value) ?? []), r.row]);
  }

  // Cargos: cómo se resuelve cada uno (una vez por cargo distinto). Primero se
  // juntan todos, porque "igual que otro cargo" necesita conocerlos a todos.
  const cargos = new Map<string, CargoOp>();
  for (const r of read.rows) {
    if (isBlank(r.cells.cargo)) continue;
    const k = normKey(r.cells.cargo);
    const c = cargos.get(k);
    if (c) c.count++;
    else cargos.set(k, { key: k, text: cleanCargo(r.cells.cargo), count: 1, resolution: { kind: "new", name: "" } });
  }
  for (const c of cargos.values()) c.resolution = resolveCargo(c, snap, overrides.cargos?.[c.key]);
  for (const c of cargos.values()) {
    const choice = overrides.cargos?.[c.key];
    if (choice?.kind !== "same") continue;
    const target = cargos.get(choice.key);
    if (!target || target.key === c.key || overrides.cargos?.[target.key]?.kind === "same") {
      throw new Error(`No se pudo unificar el cargo "${c.text}": el cargo elegido no está en el archivo o también está unificado con otro. Recargá la vista previa.`);
    }
    c.resolution = { kind: "same", into: target.key, name: target.resolution.name };
  }
  const cargoPositionName = (k: string | null) => (k ? cargos.get(k)!.resolution.name : null);

  const people: PersonOp[] = [];
  for (const r of read.rows) {
    let bad = false;
    const ced = parseCedula(r.cells.cedula);
    if ("error" in ced) {
      reject(r.row, "CEDULA", ced.error);
      bad = true;
    }
    const start = parseDate(r.cells.start_date);
    if ("error" in start) {
      reject(r.row, "FECHA DE INGRESO", isBlank(r.cells.start_date) ? "Falta la fecha de ingreso." : start.error);
      bad = true;
    }
    const fullName = cellText(r.cells.full_name).replace(/\s+/g, " ").trim();
    if (!fullName) {
      reject(r.row, "NOMBRES Y APELLIDOS", "Falta el nombre.");
      bad = true;
    }
    if (bad || "error" in ced || "error" in start) continue;
    const cedula = ced.value;
    const dup = rowsByCedula.get(cedula)!;
    if (dup.length > 1) {
      reject(r.row, "CEDULA", `La cédula ${cedula} está repetida en las filas ${dup.join(", ")}.`);
      continue;
    }
    const cargoKey = isBlank(r.cells.cargo) ? null : normKey(r.cells.cargo);

    // Persona.
    const emp = snap.employeesByCedula.get(cedula);
    let op: PersonOp;
    if (emp) {
      const differs = normKey(`${emp.first_name} ${emp.last_name}`) !== normKey(fullName);
      op = {
        row: r.row, cedula, employee: "existing", employeeId: emp.id, firstName: emp.first_name, lastName: emp.last_name,
        ...(differs ? { fileName: fullName } : {}),
        contract: "create", startDate: start.value, cargoKey, changes: [],
      };
    } else {
      const split = splitFullName(fullName, overrides.splits?.[cedula]);
      if (!split) {
        reject(r.row, "NOMBRES Y APELLIDOS", `"${fullName}" no se puede separar en nombres y apellidos (tiene una sola palabra).`);
        continue;
      }
      op = {
        row: r.row, cedula, employee: "create", firstName: split.firstName, lastName: split.lastName,
        split: { tokens: split.tokens, boundary: split.boundary, ambiguous: split.ambiguous && overrides.splits?.[cedula] === undefined },
        contract: "create", startDate: start.value, cargoKey, changes: [],
      };
    }

    // Contrato en esta empresa (docs/14 §3.3).
    const contracts = emp ? (snap.contractsByEmployee.get(emp.id) ?? []) : [];
    const same = contracts.find((c) => c.start_date === start.value);
    if (same) {
      const from = same.position_id != null ? (snap.positionsById.get(same.position_id) ?? null) : null;
      const to = cargoPositionName(cargoKey);
      const changes = to !== null && normKey(from ?? "") !== normKey(to) ? [{ field: "Puesto", from, to }] : [];
      if (same.status !== "active" && changes.length) {
        reject(r.row, null, `Su contrato desde ${fmt(same.start_date)} está cerrado (baja ${fmt(same.end_date)}): no se modifica.`);
        continue;
      }
      op.contract = changes.length ? "update" : "same";
      op.contractId = same.id;
      op.changes = changes;
    } else {
      const active = contracts.find((c) => c.status === "active");
      if (active) {
        reject(r.row, "FECHA DE INGRESO", `Ya tiene un contrato vigente en esta empresa desde ${fmt(active.start_date)}. Si es la misma relación laboral, corregí la fecha en el Excel; si es un reingreso, primero dale de baja al contrato anterior en el panel.`);
        continue;
      }
    }
    people.push(op);
  }

  const inFile = new Set(rowsByCedula.keys());
  return {
    companyId,
    people,
    cargos: [...cargos.values()],
    absent: snap.activeInCompany.filter((a) => !inFile.has(a.cedula)),
    rejected,
    warnings: read.warnings,
    ok: rejected.length === 0,
  };
}

/** Cómo se resuelve un cargo sin contar "igual que otro cargo" (eso va aparte). */
function resolveCargo(c: CargoOp, snap: Snapshot, choice: CargoChoice | undefined): CargoResolution {
  if (choice?.kind === "position") {
    const name = snap.positionsById.get(choice.id);
    if (!name) throw new Error(`El puesto elegido para "${c.text}" ya no existe. Recargá la vista previa.`);
    return { kind: "mapped", positionId: choice.id, name };
  }
  if (choice?.kind === "new") {
    const name = cleanText(choice.name ?? "") || c.text;
    // Si el nombre corregido ya existe como puesto, es ese (no se duplica).
    const existing = snap.positionsByKey.get(normKey(name));
    return existing ? { kind: "mapped", positionId: existing.id, name: existing.name } : { kind: "new", name };
  }
  const byName = snap.positionsByKey.get(c.key);
  if (byName) return { kind: "position", positionId: byName.id, name: byName.name };
  const byAlias = snap.aliases.get(c.key);
  if (byAlias) return { kind: "alias", positionId: byAlias.id, name: byAlias.name };
  return { kind: "new", name: c.text };
}

function fmt(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
