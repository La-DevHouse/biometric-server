/**
 * Registry driving the raw command form in Diagnóstico. `params` maps each
 * field name to placeholder text (not a default value) — this is the tool
 * that found every firmware quirk documented in docs/05-commands-catalog.md, so it
 * intentionally stays low-level (one command, its raw params) rather than
 * being folded into the higher-level lib/operations vocabulary.
 */
export const COMMAND_TEMPLATES: Record<
  string,
  { label: string; params?: Record<string, string> }
> = {
  GET_DEVICE_STATUS: { label: "Consultar estado del equipo" },
  SET_TIME: { label: "Sincronizar hora (con la del servidor)" },
  SET_FK_NAME: { label: "Cambiar nombre del equipo", params: { fk_name: "nombre_del_equipo" } },

  GET_USER_ID_LIST: { label: "Listar usuarios" },
  GET_USER_INFO: { label: "Consultar usuario", params: { user_id: "id_usuario" } },
  SET_USER_INFO: {
    label: "Crear usuario (solo nuevos — reindexa si ya existe)",
    params: { user_id: "id_usuario", user_name: "nombre", user_privilege: "USER" },
  },
  SET_USER_NAME: {
    label: "Renombrar usuario",
    params: { user_id: "id_usuario", user_name: "nombre_nuevo (trunca a 8)" },
  },
  SET_USER_PRIVILEGE: {
    label: "Cambiar privilegio",
    params: { user_id: "id_usuario", user_privilege: "MANAGER|REGISTER|OPERATOR|USER" },
  },
  DELETE_USER: { label: "Eliminar usuario", params: { user_id: "id_usuario" } },

  GET_ENROLL_DATA: {
    label: "Consultar biométrico",
    params: { user_id: "id_usuario", backup_number: "0-12" },
  },
  SET_ENROLL_DATA: {
    label: "Cargar biométrico",
    params: { user_id: "id_usuario", backup_number: "0-12" },
  },

  GET_LOG_DATA: {
    label: "Descargar marcaciones",
    params: { begin_time: "", end_time: "" },
  },
  CLEAR_LOG_DATA: { label: "Borrar marcaciones del equipo" },
  CLEAR_ENROLL_DATA: { label: "Borrar biométricos del equipo" },
};

export type CommandCode = keyof typeof COMMAND_TEMPLATES;
