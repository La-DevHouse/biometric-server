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
