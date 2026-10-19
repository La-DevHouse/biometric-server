import type { ReactNode } from "react";

/**
 * El lenguaje de íconos del panel: un solo lugar para verlos todos.
 *
 * SVG y no caracteres Unicode (antes "✎", "◷", "↻", "⌖"…): cada glifo salía
 * de una fuente distinta según la plataforma, con su propio tamaño, grosor y
 * línea base — en una fila de botones-ícono se veían desparejos y
 * descentrados. Acá todos comparten la misma grilla (24×24), el mismo trazo
 * (2px, puntas redondeadas) y miden `1em`: toman el tamaño de fuente del
 * contenedor (--icon-glyph en los botones-ícono), y `display:block` evita el
 * corrimiento por la línea base del texto.
 */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="block flex-none"
    >
      {children}
    </svg>
  );
}

export const Icon = {
  add: <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  camera: (
    <Svg>
      <path d="M3 8h4l2-3h6l2 3h4v11H3z" />
      <circle cx="12" cy="13" r="3.5" />
    </Svg>
  ),
  upload: <Svg><path d="M12 16V4M7 9l5-5 5 5M4 20h16" /></Svg>,
  sync: <Svg><path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9M19 3v4.5h-4.5M5 21v-4.5h4.5" /></Svg>,
  trash: <Svg><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" /></Svg>,
  edit: <Svg><path d="M4 20l1.2-4.8L16 4.4 19.6 8 8.8 18.8zM13.6 6.8l3.6 3.6" /></Svg>,
  key: (
    <Svg>
      <circle cx="8" cy="15" r="4" />
      <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
    </Svg>
  ),
  power: <Svg><path d="M12 3v9M6.3 6.8a8 8 0 1 0 11.4 0" /></Svg>,
  check: <Svg><path d="M5 12.5l4.5 4.5L19 7" /></Svg>,
  close: <Svg><path d="M6 6l12 12M18 6L6 18" /></Svg>,
  rank: <Svg><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></Svg>,
  view: (
    <Svg>
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  unlink: <Svg><path d="M9.5 14.5l-2.3 2.3a3.5 3.5 0 0 1-5-5l2.3-2.3M14.5 9.5l2.3-2.3a3.5 3.5 0 0 1 5 5l-2.3 2.3M4 4l16 16" /></Svg>,
  send: <Svg><path d="M4 12h15M13 6l6 6-6 6" /></Svg>,
  capture: <Svg><path d="M12 4v11M7 10l5 5 5-5M4 20h16" /></Svg>,
  clock: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </Svg>
  ),
  refresh: <Svg><path d="M20 12a8 8 0 1 1-2.4-5.7M20 4v4.5h-4.5" /></Svg>,
  // Pin de ubicación: "asignar sede".
  assign: (
    <Svg>
      <path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </Svg>
  ),
  // --- Menú lateral (AdminShell): una figura por sección ---
  navHome: (
    <Svg>
      <path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5" />
    </Svg>
  ),
  // Huella: los equipos son biométricos.
  navDevices: (
    <Svg>
      <path d="M5.2 6.5a8.5 8.5 0 0 1 13.6 0" />
      <path d="M6.6 19.5C6 17.9 5.5 16 5.5 13.5a6.5 6.5 0 0 1 13 0c0 1.2-.1 2.4-.3 3.5" />
      <path d="M10.4 21c-.7-1.9-1.1-4.2-1.1-7.2a2.7 2.7 0 0 1 5.4 0c0 2.4-.3 4.6-.9 6.7M12 13.8c0 2.4.2 4.5.7 6.2" />
    </Svg>
  ),
  navCompanies: (
    <Svg>
      <path d="M4 21V5.5L12 3v18M12 21V9l8 2.5V21M2.5 21h19" />
      <path d="M7.5 8h1.5M7.5 12h1.5M7.5 16h1.5M15.5 14h1.5M15.5 17.5h1.5" />
    </Svg>
  ),
  // Capas: un grupo de empresas (buscador).
  navGroups: (
    <Svg>
      <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
      <path d="M3.5 12.5l8.5 4.5 8.5-4.5M3.5 16.5l8.5 4.5 8.5-4.5" />
    </Svg>
  ),
  navEmployees: (
    <Svg>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21c0-4.1 3.4-7 7.5-7s7.5 2.9 7.5 7" />
    </Svg>
  ),
  navCategories: (
    <Svg>
      <path d="M3.5 3.5h7.8l9.2 9.2-7.8 7.8-9.2-9.2z" />
      <circle cx="8" cy="8" r="1.4" />
    </Svg>
  ),
  navSchedules: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.2 2" />
    </Svg>
  ),
  // Persona dentro de un círculo (avatar de cuenta), distinta de Empleados.
  navAccounts: (
    <Svg>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="10" r="3" />
      <path d="M6.6 18.6c1.3-1.9 3.2-2.9 5.4-2.9s4.1 1 5.4 2.9" />
    </Svg>
  ),
  // Hoja con renglones y lupa: el registro de quién hizo qué.
  navAudit: (
    <Svg>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
      <path d="M8 8h6M8 12h4" />
      <circle cx="16.5" cy="16.5" r="3.5" />
      <path d="M19 19l2.5 2.5" />
    </Svg>
  ),
  // Equipo (terminal con pantalla) + "+": agregar un equipo a una sede.
  addDevice: (
    <Svg>
      <rect x="3" y="3" width="11" height="18" rx="2" />
      <path d="M6.5 7h4M8.5 17h0M19 9v6M16 12h6" />
    </Svg>
  ),
  export: <Svg><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></Svg>,
} as const;

/**
 * La maqueta usa "⛃" para "Filtrar" — en Chromium ese glifo renderiza como un
 * dado negro sin relación con "filtrar". Mismo set que `Icon` (1em, trazo 2).
 */
export function FunnelIcon() {
  return (
    <Svg>
      <path d="M3 4h18l-7 8.5V19l-4 2v-8.5z" />
    </Svg>
  );
}
