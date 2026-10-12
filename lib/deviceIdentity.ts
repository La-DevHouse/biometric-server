// Identidad de un equipo a partir de lo que manda por el cable.
//
// Regla (docs/04 → "dev_id placeholder"): la identidad es el header `dev_id`,
// SALVO que sea un placeholder de firmware. Verificado (2026-10-12) que los
// faciales WS545CW_FP3FC5_BSCS_V2.0.33 mandan siempre dev_id 000000000001 —
// todos los de ese modelo se ven como el mismo equipo — aunque su pantalla de
// información muestre el serial real. Lo que sí traen es el serial en
// `fk_name` (de fábrica); en esos equipos la identidad es el fk_name.
//
// Consecuencias que se aceptan:
//  - El fk_name no se cambia desde el panel (el nombre visible es devices.name).
//  - Si alguien cambia el fk_name de un facial desde su teclado, el servidor lo
//    ve como un equipo nuevo. Arreglo manual: escribir el serial de la caja (o
//    de "Info del sistema") en el nombre del equipo.
//  - Un facial con fk_name vacío no se puede identificar: queda en cuarentena
//    (se le contesta sin comandos y no se registra) hasta que se le escriba.
//  - Solo receive_cmd trae fk_name. send_cmd_result se atribuye por trans_id
//    (commands.dev_id); realtime_glog / realtime_enroll_data de un placeholder
//    no se pueden atribuir y se descartan — sus marcaciones entran por el pull
//    periódico de GET_LOG_DATA (el equipo las conserva en memoria).

const DEFAULT_PLACEHOLDERS = ["000000000001"];

/** Lista configurable (PLACEHOLDER_DEV_IDS, separada por comas) por si aparece otro firmware igual. */
export function placeholderDevIds(): ReadonlySet<string> {
  const raw = process.env.PLACEHOLDER_DEV_IDS;
  const list = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : DEFAULT_PLACEHOLDERS;
  return new Set(list);
}

export function isPlaceholderDevId(reported: string | null | undefined): boolean {
  return reported != null && placeholderDevIds().has(reported.trim());
}

export type DeviceIdentity =
  | { kind: "serial"; devId: string; reported: string }
  | { kind: "fk_name"; devId: string; reported: string }
  | { kind: "quarantine"; reported: string };

/** Resuelve la identidad en receive_cmd (el único request que trae fk_name). */
export function resolveDeviceIdentity(reported: string, fkName: string | null | undefined): DeviceIdentity {
  const r = reported.trim();
  if (!isPlaceholderDevId(r)) return { kind: "serial", devId: r, reported: r };
  const name = (fkName ?? "").trim();
  // Un fk_name que también es placeholder no identifica nada.
  if (!name || isPlaceholderDevId(name)) return { kind: "quarantine", reported: r };
  return { kind: "fk_name", devId: name, reported: r };
}

/** Lo que se muestra en el panel: el nombre puesto en el panel, o el id. */
export function deviceLabel(d: { dev_id: string; name?: string | null }): string {
  return d.name?.trim() || d.dev_id;
}
