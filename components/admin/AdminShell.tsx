"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { Tag } from "@/components/ui/Tag";
import { ToastProvider } from "./Toaster";
import { OperationsTrackerProvider } from "./OperationsTracker";
import { logoutAction } from "@/app/login/actions";
import { CommandPalette } from "./CommandPalette";

// Glifos mono por ítem — parte de la maqueta "Menú lateral" (2026-09-23), no
// del set de acciones de components/ui/icons.tsx (ese es para botones de
// toolbar; estos son de navegación, un caso aparte).
const NAV_ITEMS = [
  { href: "/admin", label: "Inicio", icon: "⌂" },
  { href: "/admin/dispositivos", label: "Equipos", icon: "▤" },
] as const;

const ADMIN_ITEMS = [
  { href: "/admin/empresas", label: "Empresas", icon: "▢" },
  { href: "/admin/empleados", label: "Empleados", icon: "◉" },
  { href: "/admin/categorias", label: "Categorías", icon: "☰" },
  { href: "/admin/horarios", label: "Horarios y turnos", icon: "◫" },
  { href: "/admin/cuentas", label: "Cuentas", icon: "⚿" }
] as const;

const TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: "/admin/dispositivos/", title: "Detalle de equipo" },
  { prefix: "/admin/dispositivos", title: "Equipos" },
  { prefix: "/admin/empresas/", title: "Detalle de empresa" },
  { prefix: "/admin/empresas", title: "Empresas" },
  { prefix: "/admin/empleados/", title: "Detalle de empleado" },
  { prefix: "/admin/empleados", title: "Empleados" },
  { prefix: "/admin/categorias", title: "Categorías" },
  { prefix: "/admin/horarios/", title: "Detalle de horario" },
  { prefix: "/admin/horarios", title: "Horarios y turnos" },
  { prefix: "/admin/cuentas", title: "Cuentas de plataforma" },
  { prefix: "/admin/diagnostico", title: "Diagnóstico / Avanzado" },
  { prefix: "/admin", title: "Inicio" },
];

const ROLE_LABEL: Record<"admin" | "operator" | "viewer", string> = {
  admin: "Administrador",
  operator: "Operador",
  viewer: "Visor",
};

function titleFor(pathname: string): string {
  return TITLES.find((t) => pathname.startsWith(t.prefix))?.title ?? "";
}

/** Highlights "Equipos" while viewing a device's own detail page too. */
function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(href);
}

export function AdminShell({
  userName,
  userRole,
  deviceCount,
  children,
}: {
  userName?: string;
  userRole?: "admin" | "operator" | "viewer";
  /** Badge junto a "Equipos" — total de equipos registrados. */
  deviceCount?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Cerrar el drawer al navegar — cubre tanto el click en un link (más
  // inmediato) como cualquier otra forma de cambiar de ruta.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Medidas exactas de la maqueta "Menú lateral" (px), no de la escala de
  // spacing de 3.4px del resto del sistema — esa escala no la calibraron
  // para este componente y casi ningún valor de acá cae justo en un
  // múltiplo suyo (16, 14, 10, 32, 28...). Mejor explícito que "parecido".
  function navLinkClass(href: string) {
    const active = isNavActive(pathname, href);
    return cx(
      "flex items-center gap-[12px] h-[40px] px-[18px] text-[15px] font-medium no-underline border-l-2",
      active
        ? "bg-accent text-white font-semibold border-l-text"
        : "text-text border-l-transparent hover:bg-chrome hover:border-l-neutral-500"
    );
  }

  function navIconClass(href: string) {
    return cx(
      "font-mono text-[18px] leading-none w-[18px] flex-none text-center",
      isNavActive(pathname, href) ? "text-[#cfe0f1]" : "text-neutral-700"
    );
  }

  return (
    <ToastProvider>
      <OperationsTrackerProvider>
      {/* h-dvh, no h-screen: 100vh no descuenta la barra de direcciones
          dinámica del navegador en mobile — recorta el fondo de la página
          (el último ítem de una lista larga queda inalcanzable). */}
      <div className="flex h-dvh overflow-hidden bg-bg">
        {/* Backdrop del drawer — solo existe (y solo importa) por debajo de md */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-30 bg-text/40 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        <aside
          className={cx(
            "w-full md:w-[268px] flex-none bg-surface border-r border-divider flex flex-col",
            "fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out",
            "md:static md:translate-x-0",
            mobileOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <div className="flex items-center gap-[12px] pt-[18px] pr-[18px] pb-[16px] pl-[18px] border-b border-neutral-200">
            <div className="relative w-[40px] h-[40px] flex-none border border-neutral-400 bg-chrome">
              <Image src="/logo-alco.jpg" alt="" fill sizes="40px" className="object-contain p-0.5" />
            </div>
            <div className="flex flex-col gap-[2px] min-w-0">
              <span className="text-[15px] font-semibold tracking-[-0.01em] truncate">Grupo ALCO</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-neutral-700">Biometría</span>
            </div>
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              aria-label="Cerrar menú de navegación"
              className="ml-auto flex-none w-[40px] h-[40px] flex items-center justify-center border border-neutral-500 bg-transparent cursor-pointer text-[20px] leading-none md:hidden"
            >
              ×
            </button>
          </div>

          <nav className="flex-1 flex flex-col py-[12px] overflow-y-auto">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
                <span className={navIconClass(item.href)} aria-hidden>
                  {item.icon}
                </span>
                {item.label}
                {item.href === "/admin/dispositivos" && deviceCount != null && (
                  <Tag variant="accent" className="ml-auto px-[5px]! py-[1px]! tracking-normal!">
                    {deviceCount}
                  </Tag>
                )}
              </Link>
            ))}

            <div className="flex items-center gap-[8px] px-[18px] mt-[16px] mb-[8px]">
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-neutral-700">
                Administración
              </span>
              <span className="flex-1 h-px bg-neutral-200" />
            </div>

            {ADMIN_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className={navLinkClass(item.href)}>
                <span className={navIconClass(item.href)} aria-hidden>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            ))}
          </nav>

          {userName && (
            <div className="border-t border-neutral-200 py-[12px] px-[14px] flex items-center gap-[12px]">
              <span className="w-[34px] h-[34px] flex-none bg-text text-white font-mono text-[14px] font-semibold flex items-center justify-center">
                {userName.trim().charAt(0).toUpperCase() || "?"}
              </span>
              <span className="flex flex-col min-w-0 flex-1">
                <span className="text-[14px] font-semibold truncate" title={userName}>
                  {userName}
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-neutral-700">
                  {ROLE_LABEL[userRole ?? "admin"]}
                </span>
              </span>
              <form action={logoutAction}>
                <button
                  type="submit"
                  title="Salir"
                  aria-label="Salir"
                  className="w-[34px] h-[34px] flex-none flex items-center justify-center bg-transparent border border-neutral-500 hover:border-text text-text text-[19px] leading-none cursor-pointer"
                >
                  ⏻
                </button>
              </form>
            </div>
          )}
        </aside>

        <main className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center gap-[12px] px-[14px] md:px-[24px] h-[56px] md:h-[64px] flex-none bg-surface md:bg-transparent border-b border-divider">
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? "Cerrar menú" : "Abrir menú"}
              aria-expanded={mobileOpen}
              className="flex-none w-[40px] h-[40px] flex items-center justify-center border border-neutral-500 bg-transparent cursor-pointer text-[25px] leading-none md:hidden"
            >
              {/* SVG y no el glifo "☰": la fuente lo dibuja por debajo del centro
                  de la caja. 18×14 = 1.25× el glifo anterior. */}
              {mobileOpen ? (
                "×"
              ) : (
                <svg viewBox="0 0 18 14" width="18" height="14" aria-hidden className="block">
                  <path d="M0 1h18M0 7h18M0 13h18" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
            <h4 className="font-heading text-xl font-semibold tracking-[-0.01em] m-0 truncate">{titleFor(pathname)}</h4>
            <CommandPalette />
          </header>

          <div className="flex-1 overflow-y-auto p-[16px] md:p-[28px]">{children}</div>
        </main>
      </div>
      </OperationsTrackerProvider>
    </ToastProvider>
  );
}
