// Plan de importación de trabajadores a UNA empresa (docs/14): qué personas se
// crean, qué contratos se crean o cambian, qué se rechaza. `loadSnapshot` trae de
// la base lo necesario EN LOTE; `buildPlan` es puro sobre ese snapshot.
//
// Reglas (docs/14 §7):
//   D1 — con una sola fila rechazada no se aplica nada.
//   D2 — un dato vacío no borra nada. A una persona que ya existe no se le cambia
//        el nombre (el del sistema puede venir de escanear su cédula; el del
//        archivo es una sola celda partida por heurística): si difiere, se avisa.
//        La fecha de nacimiento sí: si el archivo la trae y es otra, se completa o
//        se corrige (el roster de Galepso a veces no la trae: eso no borra nada).
//   D3 — no se da de baja a nadie: los que tienen contrato vigente y no están en
//        el archivo solo se listan.
//   Cargo → puesto y departamento → departamento (categorías): el que ya existe
//        con ese nombre, o el asignado antes (alias), o el que se elija en la vista
//        previa, o uno nuevo.
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
  cargos?: Record<string, CategoryChoice>;
  /** clave del departamento del archivo → qué hacer con él. */
  departments?: Record<string, CategoryChoice>;
}

/**
 * Qué hacer con un cargo o un departamento del archivo (vista previa):
 *  - new: crearlo, con el nombre dado (por defecto el del archivo);
 *  - existing: usar uno que ya existe;
 *  - same: lo mismo que otro de este archivo (unificar "HORMERO" con "HORNERO").
 */
export type CategoryChoice = { kind: "new"; name?: string } | { kind: "existing"; id: number } | { kind: "same"; key: string };

export type CategoryResolution =
  /** Ya existe uno con ese nombre. */
  | { kind: "existing"; id: number; name: string }
  /** Asignado en una importación anterior. */
  | { kind: "alias"; id: number; name: string }
  /** Elegido en esta vista previa. */
  | { kind: "mapped"; id: number; name: string }
  | { kind: "new"; name: string }
  /** Unificado con otro del archivo: termina en el mismo que ese. */
  | { kind: "same"; into: string; name: string };

export interface CategoryOp {
  key: string;
  text: string;
  count: number;
  resolution: CategoryResolution;
  /** Solo cargos: claves de los departamentos del archivo en los que aparece. */
  departments?: string[];
}

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
  /** La del archivo (null = no la trae; nunca borra la del sistema). */
  birthDate: string | null;
  /** Persona existente: datos de su ficha que cambian (hoy, la fecha de nacimiento). */
  personChanges: Change[];
  contract: "create" | "update" | "same";
  contractId?: number;
  startDate: string;
  cargoKey: string | null;
  deptKey: string | null;
  /** Contrato existente: qué cambia (Puesto, Departamento). */
  changes: Change[];
}

export interface CompanyImportPlan {
  companyId: number;
  people: PersonOp[];
  cargos: CategoryOp[];
  departments: CategoryOp[];
  absent: Array<{ cedula: string; name: string }>;
  rejected: Rejection[];
  warnings: string[];
  ok: boolean;
}

interface Named {
  id: number;
  name: string;
}

/** Puestos o departamentos que ya hay en la base. */
export interface Catalog {
  byKey: Map<string, Named>;
  byId: Map<number, string>;
  aliases: Map<string, Named>;
}

export interface Snapshot {
  company: { id: number; name: string; status: string; business_model_id: number | null } | null;
  employeesByCedula: Map<string, { id: number; first_name: string; last_name: string; birth_date: string | null }>;
  /** Contratos de esas personas EN ESTA EMPRESA. */
  contractsByEmployee: Map<
    number,
    Array<{ id: number; start_date: string; end_date: string | null; status: string; position_id: number | null; department_id: number | null }>
  >;
  positions: Catalog;
  departments: Catalog;
  activeInCompany: Array<{ cedula: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Snapshot (lectura en lote)
// ---------------------------------------------------------------------------

function catalog(items: Named[], aliases: Array<{ alias_key: string; target: Named }>): Catalog {
  const byKey = new Map<string, Named>();
  for (const i of items) if (!byKey.has(normKey(i.name))) byKey.set(normKey(i.name), i);
  return {
    byKey,
    byId: new Map(items.map((i) => [i.id, i.name])),
    aliases: new Map(aliases.map((a) => [a.alias_key, a.target])),
  };
}

export async function loadSnapshot(companyId: number, read: ReadResult): Promise<Snapshot> {
  const cedulas = new Set<string>();
  for (const r of read.rows) {
    const c = parseCedula(r.cells.cedula);
    if ("value" in c) cedulas.add(c.value);
  }
  const [company, employees, positions, positionAliases, departments, departmentAliases, active] = await Promise.all([
    prisma.client_company.findUnique({ where: { id: companyId }, select: { id: true, name: true, status: true, business_model_id: true } }),
    prisma.employee.findMany({
      where: { national_id: { in: [...cedulas] } },
      select: { id: true, national_id: true, first_name: true, last_name: true, birth_date: true },
    }),
    prisma.position.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.position_alias.findMany({ select: { alias_key: true, position: { select: { id: true, name: true } } } }),
    prisma.department.findMany({ select: { id: true, name: true }, orderBy: { id: "asc" } }),
    prisma.department_alias.findMany({ select: { alias_key: true, department: { select: { id: true, name: true } } } }),
    prisma.employment.findMany({
      where: { company_id: companyId, ...activeEmploymentWhere() },
      select: { employee: { select: { national_id: true, first_name: true, last_name: true } } },
    }),
  ]);
  const contracts = await prisma.employment.findMany({
    where: { company_id: companyId, employee_id: { in: employees.map((e) => e.id) } },
    select: { id: true, employee_id: true, start_date: true, end_date: true, status: true, position_id: true, department_id: true },
  });

  const contractsByEmployee: Snapshot["contractsByEmployee"] = new Map();
  for (const c of contracts) {
    const list = contractsByEmployee.get(c.employee_id) ?? [];
    list.push({
      id: c.id,
      start_date: dateToYmd(c.start_date)!,
      end_date: dateToYmd(c.end_date),
      status: c.status,
      position_id: c.position_id,
      department_id: c.department_id,
    });
    contractsByEmployee.set(c.employee_id, list);
  }
  return {
    company,
    employeesByCedula: new Map(
      employees.map((e) => [e.national_id, { id: e.id, first_name: e.first_name, last_name: e.last_name, birth_date: dateToYmd(e.birth_date) }])
    ),
    contractsByEmployee,
    positions: catalog(positions, positionAliases.map((a) => ({ alias_key: a.alias_key, target: a.position }))),
    departments: catalog(departments, departmentAliases.map((a) => ({ alias_key: a.alias_key, target: a.department }))),
    activeInCompany: active.map((a) => ({ cedula: a.employee.national_id, name: `${a.employee.first_name} ${a.employee.last_name}` })),
  };
}

// ---------------------------------------------------------------------------
// Plan (puro)
// ---------------------------------------------------------------------------

/** "DESPACHADORA" → "Despachadora"; si ya viene con mayúsculas y minúsculas, se respeta. */
export function cleanLabel(raw: unknown): string {
  const t = cleanText(raw);
  return t === t.toUpperCase() ? t.charAt(0) + t.slice(1).toLowerCase() : t;
}

/** Galepso numera los departamentos por empresa ("1 - OPERATIVO"): el número no identifica nada acá. */
function departmentText(raw: unknown): string {
  return cellText(raw).replace(/^\s*\d+\s*-\s*/, "");
}

/**
 * Cómo se resuelve cada cargo (o departamento) distinto del archivo. Primero se
 * juntan todos, porque "igual que otro" necesita conocerlos a todos.
 */
function resolveCategories(texts: string[], cat: Catalog, choices: Record<string, CategoryChoice> | undefined, label: string): Map<string, CategoryOp> {
  const ops = new Map<string, CategoryOp>();
  for (const t of texts) {
    if (isBlank(t)) continue;
    const k = normKey(t);
    const c = ops.get(k);
    if (c) c.count++;
    else ops.set(k, { key: k, text: cleanLabel(t), count: 1, resolution: { kind: "new", name: "" } });
  }
  for (const c of ops.values()) c.resolution = resolveOne(c, cat, choices?.[c.key], label);
  for (const c of ops.values()) {
    const choice = choices?.[c.key];
    if (choice?.kind !== "same") continue;
    const target = ops.get(choice.key);
    if (!target || target.key === c.key || choices?.[target.key]?.kind === "same") {
      throw new Error(`No se pudo unificar ${label} "${c.text}": el elegido no está en el archivo o también está unificado con otro. Recargá la vista previa.`);
    }
    c.resolution = { kind: "same", into: target.key, name: target.resolution.name };
  }
  return ops;
}

/** Sin contar "igual que otro" (eso va aparte). */
function resolveOne(c: CategoryOp, cat: Catalog, choice: CategoryChoice | undefined, label: string): CategoryResolution {
  if (choice?.kind === "existing") {
    const name = cat.byId.get(choice.id);
    if (!name) throw new Error(`Lo elegido para ${label} "${c.text}" ya no existe. Recargá la vista previa.`);
    return { kind: "mapped", id: choice.id, name };
  }
  if (choice?.kind === "new") {
    const name = cleanText(choice.name ?? "") || c.text;
    // Si el nombre corregido ya existe, es ese (no se duplica).
    const existing = cat.byKey.get(normKey(name));
    return existing ? { kind: "mapped", id: existing.id, name: existing.name } : { kind: "new", name };
  }
  const byName = cat.byKey.get(c.key);
  if (byName) return { kind: "existing", id: byName.id, name: byName.name };
  const byAlias = cat.aliases.get(c.key);
  if (byAlias) return { kind: "alias", id: byAlias.id, name: byAlias.name };
  return { kind: "new", name: c.text };
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

  const cargos = resolveCategories(read.rows.map((r) => cellText(r.cells.cargo)), snap.positions, overrides.cargos, "el cargo");
  const departments = resolveCategories(read.rows.map((r) => departmentText(r.cells.department)), snap.departments, overrides.departments, "el departamento");
  const keyOf = (raw: string) => (isBlank(raw) ? null : normKey(raw));
  for (const r of read.rows) {
    const ck = keyOf(cellText(r.cells.cargo));
    const dk = keyOf(departmentText(r.cells.department));
    if (!ck || !dk) continue;
    const c = cargos.get(ck)!;
    if (!c.departments?.includes(dk)) c.departments = [...(c.departments ?? []), dk];
  }
  const nameOf = (ops: Map<string, CategoryOp>, k: string | null) => (k ? ops.get(k)!.resolution.name : null);

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
    const birth = isBlank(r.cells.birth_date) ? { value: null } : parseDate(r.cells.birth_date);
    if ("error" in birth) {
      reject(r.row, "FECHA DE NACIMIENTO", birth.error);
      bad = true;
    }
    if (bad || "error" in ced || "error" in start || "error" in birth) continue;
    const birthDate = birth.value;
    const cedula = ced.value;
    const dup = rowsByCedula.get(cedula)!;
    if (dup.length > 1) {
      reject(r.row, "CEDULA", `La cédula ${cedula} está repetida en las filas ${dup.join(", ")}.`);
      continue;
    }
    const cargoKey = keyOf(cellText(r.cells.cargo));
    const deptKey = keyOf(departmentText(r.cells.department));

    // Persona.
    const emp = snap.employeesByCedula.get(cedula);
    let op: PersonOp;
    if (emp) {
      const differs = normKey(`${emp.first_name} ${emp.last_name}`) !== normKey(fullName);
      op = {
        row: r.row, cedula, employee: "existing", employeeId: emp.id, firstName: emp.first_name, lastName: emp.last_name,
        ...(differs ? { fileName: fullName } : {}),
        birthDate,
        personChanges: birthDate && birthDate !== emp.birth_date ? [{ field: "Fecha de nacimiento", from: emp.birth_date, to: birthDate }] : [],
        contract: "create", startDate: start.value, cargoKey, deptKey, changes: [],
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
        birthDate, personChanges: [],
        contract: "create", startDate: start.value, cargoKey, deptKey, changes: [],
      };
    }

    // Contrato en esta empresa (docs/14 §3.3).
    const contracts = emp ? (snap.contractsByEmployee.get(emp.id) ?? []) : [];
    const same = contracts.find((c) => c.start_date === start.value);
    if (same) {
      const changes: Change[] = [];
      const diff = (field: string, from: string | null, to: string | null) => {
        if (to !== null && normKey(from ?? "") !== normKey(to)) changes.push({ field, from, to });
      };
      diff("Puesto", same.position_id != null ? (snap.positions.byId.get(same.position_id) ?? null) : null, nameOf(cargos, cargoKey));
      diff("Departamento", same.department_id != null ? (snap.departments.byId.get(same.department_id) ?? null) : null, nameOf(departments, deptKey));
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
        reject(r.row, "FECHA DE INGRESO", `Ya tiene un contrato vigente en esta empresa desde ${fmt(active.start_date)}. Si es la misma relación laboral, corregí la fecha en el archivo; si es un reingreso, primero dale de baja al contrato anterior en el panel.`);
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
    departments: [...departments.values()],
    absent: snap.activeInCompany.filter((a) => !inFile.has(a.cedula)),
    rejected,
    warnings: read.warnings,
    ok: rejected.length === 0,
  };
}

function fmt(ymd: string | null): string {
  if (!ymd) return "—";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}
