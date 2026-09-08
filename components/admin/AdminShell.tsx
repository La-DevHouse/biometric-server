"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ToastProvider } from "./Toaster";
import { logoutAction } from "@/app/login/actions";

const NAV_ITEMS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/dispositivos", label: "Dispositivos" },
  { href: "/admin/usuarios", label: "Usuarios de equipo" },
  { href: "/admin/asistencia", label: "Asistencia" },
] as const;

const ADMIN_ITEMS = [
  { href: "/admin/empresas", label: "Empresas" },
  { href: "/admin/empleados", label: "Empleados" },
  { href: "/admin/enrolamiento", label: "Enrolamiento" },
  { href: "/admin/categorias", label: "Categorías" },
  { href: "/admin/grupos", label: "Grupos y turnos" },
  { href: "/admin/cuentas", label: "Cuentas" },
] as const;

const TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: "/admin/dispositivos/", title: "Detalle de dispositivo" },
  { prefix: "/admin/dispositivos", title: "Dispositivos" },
  { prefix: "/admin/usuarios", title: "Usuarios de equipo" },
  { prefix: "/admin/asistencia", title: "Asistencia" },
  { prefix: "/admin/empresas/", title: "Detalle de empresa" },
  { prefix: "/admin/empresas", title: "Empresas" },
  { prefix: "/admin/empleados/", title: "Detalle de empleado" },
  { prefix: "/admin/empleados", title: "Empleados" },
  { prefix: "/admin/enrolamiento", title: "Enrolamiento" },
  { prefix: "/admin/categorias", title: "Departamentos y Puestos" },
  { prefix: "/admin/grupos/", title: "Detalle de grupo" },
  { prefix: "/admin/grupos", title: "Grupos y turnos" },
  { prefix: "/admin/cuentas", title: "Cuentas de plataforma" },
  { prefix: "/admin/diagnostico", title: "Diagnóstico / Avanzado" },
  { prefix: "/admin", title: "Inicio" },
];

function titleFor(pathname: string): string {
  return TITLES.find((t) => pathname.startsWith(t.prefix))?.title ?? "";
}

/** Highlights "Dispositivos" while viewing a device's own detail page too. */
function isNavActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname.startsWith(href);
}

function UserMenu({ userName }: { userName: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const initial = userName.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Menú de usuario"
        className="w-9 h-9 rounded-full bg-accent text-bg font-heading font-semibold text-sm flex items-center justify-center cursor-pointer border-none"
      >
        {initial}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1.5 w-52 border border-divider bg-bg shadow-lg z-50 flex flex-col py-1">
          <div className="px-3 py-2 text-sm text-text truncate border-b border-divider" title={userName}>
            {userName}
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm text-text hover:bg-surface cursor-pointer bg-transparent border-none"
            >
              Salir
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

export function AdminShell({
  userName,
  children,
}: {
  userName?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-bg">
        <aside className="w-[214px] flex-none border-r border-divider flex flex-col">
        <div className="flex items-center justify-center px-4 pt-[18px] pb-3.5 border-b border-divider">
          <Image
            src="/logo-alco.jpg"
            alt="Grupo Alco"
            width={140}
            height={140}
            className="rounded-sm"
            priority
          />
        </div>

        <nav className="flex flex-col p-2 gap-0.5 flex-1">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "block px-2.5 py-2.5 text-sm no-underline",
                isNavActive(pathname, item.href)
                  ? "bg-accent text-bg font-medium"
                  : "text-text hover:text-accent"
              )}
            >
              {item.label}
            </Link>
          ))}

          <div className="mt-3.5 px-2.5 text-[10px] tracking-widest uppercase text-neutral-600">
            Administración
          </div>
          {ADMIN_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cx(
                "block px-2.5 py-2.5 text-sm no-underline",
                isNavActive(pathname, item.href)
                  ? "bg-accent text-bg font-medium"
                  : "text-text hover:text-accent"
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-4 px-6 py-3.5 border-b border-divider">
          <h4 className="m-0 text-[22px]">{titleFor(pathname)}</h4>
          {userName && (
            <div className="ml-auto">
              <UserMenu userName={userName} />
            </div>
          )}
        </header>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </main>
      </div>
    </ToastProvider>
  );
}
