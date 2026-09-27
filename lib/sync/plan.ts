// Decisión del reconciliador (docs/10-reestructura-dominio-sync.md §4.2, §4.5) como
// función pura: estado deseado vs. estado real de UN equipo → qué agregar, qué
// completar, qué quitar y si hay que frenar un borrado masivo. Sin DB ni I/O —
// lib/sync/reconcile.ts junta los datos y ejecuta el resultado.

export interface DeviceUser {
  userId: string;
  privilege: string | null; // null = no se sabe (nunca leído)
}

export interface ScopedEmployee {
  employeeId: number;
  cedula: string; // = device_user_id
  name: string;
  /** Copias canónicas deseadas (las 10 primeras) que todavía no están en ningún slot del equipo. */
  missingFingerprints: number;
}

export interface ReconcileInput {
  /** Empleados que deberían existir en este equipo (alcance, docs/10 R6). */
  inScope: ScopedEmployee[];
  /** Usuarios que el equipo tiene (caché `users` ∪ vínculos activos). */
  deviceUsers: DeviceUser[];
  /** cédula → employee.id de TODOS los empleados del sistema (no solo los del alcance). */
  employeeByCedula: Map<string, number>;
  /** Umbral del freno de borrado masivo (R8): absoluto y porcentaje del total de usuarios del equipo. */
  maxRemovals: number;
  maxRemovalsPct: number;
}

export interface Removal {
  userId: string;
  employeeId: number;
}

export interface ReconcilePlan {
  /** No existen en el equipo → alta (ADD_EMPLOYEE_TO_DEVICE: crea sin huella y copia las que haya). */
  add: ScopedEmployee[];
  /** Existen pero les faltan huellas → completar (ADD_EMPLOYEE_TO_DEVICE vincula por cédula y copia lo que falta). */
  complete: ScopedEmployee[];
  /** A borrar ya (pasaron todas las salvaguardas y el freno). */
  remove: Removal[];
  /** Habrían sido borrados, pero superan el umbral → sync_hold, nada se borra. */
  held: Removal[];
  /** Admins (MANAGER/OPERATOR) o de privilegio desconocido fuera del alcance: nunca se tocan. */
  protectedUsers: string[];
  /** IDs del equipo que no son la cédula de ningún empleado: no se tocan, van a la vista de desajustes. */
  unknownUsers: string[];
}

const PROTECTED_PRIVILEGES = new Set(["MANAGER", "OPERATOR"]);

export function planReconcile(input: ReconcileInput): ReconcilePlan {
  const present = new Map(input.deviceUsers.map((u) => [u.userId, u]));
  const scopeByCedula = new Map(input.inScope.map((e) => [e.cedula, e]));

  const add: ScopedEmployee[] = [];
  const complete: ScopedEmployee[] = [];
  for (const e of input.inScope) {
    if (!present.has(e.cedula)) add.push(e);
    else if (e.missingFingerprints > 0) complete.push(e);
  }

  const candidates: Removal[] = [];
  const protectedUsers: string[] = [];
  const unknownUsers: string[] = [];
  for (const u of input.deviceUsers) {
    if (scopeByCedula.has(u.userId)) continue;
    const employeeId = input.employeeByCedula.get(u.userId);
    // Salvaguarda 1: solo se tocan cédulas de empleados del sistema.
    if (employeeId === undefined) {
      unknownUsers.push(u.userId);
      continue;
    }
    // Salvaguarda 3: nunca admins, ni alguien cuyo privilegio no conocemos.
    if (u.privilege === null || PROTECTED_PRIVILEGES.has(u.privilege)) {
      protectedUsers.push(u.userId);
      continue;
    }
    candidates.push({ userId: u.userId, employeeId });
  }

  // Salvaguarda 4: freno de borrado masivo. Se permite hasta el mayor de los dos
  // umbrales (así un equipo chico no queda frenado por un solo borrado).
  const limit = Math.max(input.maxRemovals, Math.ceil((input.maxRemovalsPct / 100) * input.deviceUsers.length));
  const tooMany = candidates.length > limit;

  return {
    add,
    complete,
    remove: tooMany ? [] : candidates,
    held: tooMany ? candidates : [],
    protectedUsers,
    unknownUsers,
  };
}

// -----------------------------------------------------------------------------
// Qué usuarios releer (GET_USER_INFO) en una corrida
// -----------------------------------------------------------------------------

export interface ReadSelectionInput {
  /** GET_USER_ID_LIST: exactamente los usuarios con ≥1 huella (T2). */
  listed: string[];
  /** device_user_id de los empleados vinculados (activos) a este equipo. */
  linked: string[];
  /** Caché del equipo: privilegio leído y cuántas huellas (slots 0–9) le conocemos. */
  cached: Map<string, { privilege: string | null; fingerprints: number }>;
  /** Avisos del equipo (realtime_enroll_data): alguien enroló un dedo en el teclado. */
  hints: string[];
  /** fp_count del GET_DEVICE_STATUS de esta corrida. */
  deviceFpCount: number;
}

export interface ReadSelection {
  toRead: string[];
  /** true = no se pudo explicar el cambio con la caché → relectura completa (como antes). */
  full: boolean;
  /** En caché con huellas pero ya no en la lista → hoy tienen 0 huellas: limpiar su caché. */
  staleNoFingerprints: string[];
}

/**
 * Antes cada corrida releía a TODOS los usuarios con huella + vinculados en cuanto
 * cambiaba un contador — y los contadores cambian con cada escritura nuestra, así
 * que una copia disparaba decenas de GET_USER_INFO, el comando que a veces deja al
 * equipo mudo ~2 min (docs/10 O9). Ahora se lee solo lo que cambió o no se conoce;
 * si igual el total de huellas no cierra, se cae a la relectura completa.
 */
export function selectUsersToRead(input: ReadSelectionInput): ReadSelection {
  const listed = new Set(input.listed);
  const staleNoFingerprints = [...input.cached]
    .filter(([id, c]) => c.fingerprints > 0 && !listed.has(id))
    .map(([id]) => id);

  const toRead = new Set<string>();
  for (const id of input.listed) {
    const c = input.cached.get(id);
    if (!c || c.fingerprints === 0 || c.privilege === null) toRead.add(id); // nuevo, primera huella o privilegio desconocido
  }
  for (const id of input.linked) {
    const c = input.cached.get(id);
    if (!c || c.privilege === null) toRead.add(id); // vinculado que nunca se leyó
  }
  for (const id of input.hints) toRead.add(id);

  if (toRead.size === 0) {
    const expected = input.listed.reduce((n, id) => n + (input.cached.get(id)?.fingerprints ?? 0), 0);
    if (expected !== input.deviceFpCount) {
      return { toRead: [...new Set([...input.listed, ...input.linked])], full: true, staleNoFingerprints };
    }
  }
  return { toRead: [...toRead], full: false, staleNoFingerprints };
}

// -----------------------------------------------------------------------------
// Revisión nocturna de la caché de usuarios del equipo
// -----------------------------------------------------------------------------

/**
 * El equipo no tiene cómo listar a los usuarios SIN huella (GET_USER_ID_LIST solo
 * trae a los que tienen, T2) y un GET_USER_INFO sin respuesta no prueba que alguien
 * no exista (O9). Así que se cuadra por conteo: el equipo tiene
 * `deviceNoFp` = total_user_count − |lista| usuarios sin huella. Si los que tenemos
 * en caché sin huella y CONTESTARON "existo" son exactamente esa cantidad, la caché
 * es exacta y los que no contestaron ya no están → se sacan. Si no cierra (hay en el
 * equipo usuarios que no conocemos), no se toca nada y la caché queda "no exacta".
 */
export function auditVerdict(input: { check: string[]; confirmed: string[]; deviceNoFp: number | undefined }): {
  exact: boolean;
  gone: string[];
} {
  const confirmed = new Set(input.confirmed.filter((id) => input.check.includes(id)));
  const exact = input.deviceNoFp !== undefined && confirmed.size === input.deviceNoFp;
  return { exact, gone: exact ? input.check.filter((id) => !confirmed.has(id)) : [] };
}
