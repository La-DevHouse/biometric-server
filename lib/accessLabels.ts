// Nombres y descripciones de los perfiles (docs/18). Aparte de lib/access.ts para
// que los componentes de cliente los usen sin arrastrar la base de datos.

export type Profile = "admin" | "viewer" | "operator";

export const PROFILE_LABEL: Record<Profile, string> = {
  admin: "Administrador",
  viewer: "Solo lectura",
  operator: "Socio",
};

export const PROFILE_HINT: Record<Profile, string> = {
  admin: "Ve y hace todo, en todas las empresas. Administra cuentas y ve la auditoría.",
  viewer: "Ve y descarga, sin cambiar nada. En todas las empresas o solo en algunas.",
  operator: "Trabaja solo con las empresas que se le asignen. No crea empresas ni edita huellas.",
};
