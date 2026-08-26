"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ToastProvider } from "./Toaster";
import { OpTracker } from "./OpTracker";

const NAV_ITEMS = [
  { href: "/admin", label: "Inicio" },
  { href: "/admin/dispositivos", label: "Dispositivos" },
  { href: "/admin/usuarios", label: "Usuarios" },
  { href: "/admin/asistencia", label: "Asistencia" },
] as const;

const TITLES: Array<{ prefix: string; title: string }> = [
  { prefix: "/admin/dispositivos/", title: "Detalle de dispositivo" },
  { prefix: "/admin/dispositivos", title: "Dispositivos" },
  { prefix: "/admin/usuarios", title: "Usuarios" },
  { prefix: "/admin/asistencia", title: "Asistencia" },
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

export function AdminShell({
  activeOpsCount,
  children,
}: {
  activeOpsCount: number;
  children: ReactNode;
}) {
  const pathname = usePathname();

  return (
    <ToastProvider>
      <div className="flex h-screen overflow-hidden bg-bg">
        <OpTracker />
        <aside className="w-[214px] flex-none border-r border-divider flex flex-col">
        <div className="px-4 pt-[18px] pb-3.5 border-b border-divider">
          <div className="font-heading font-semibold text-xl tracking-[0.04em]">MARCAJE</div>
          <div className="text-[11px] tracking-[0.08em] uppercase text-accent-700">
            Control de asistencia
          </div>
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

          <div className="mt-3.5 px-2.5 text-[10px] tracking-[0.1em] uppercase text-neutral-600">
            Avanzado
          </div>
          <Link
            href="/admin/diagnostico"
            className={cx(
              "block px-2.5 py-2.5 text-sm no-underline",
              isNavActive(pathname, "/admin/diagnostico")
                ? "bg-accent text-bg font-medium"
                : "text-text hover:text-accent"
            )}
          >
            Diagnóstico
          </Link>
        </nav>

        <div className="px-4 py-3 border-t border-divider text-[11px] text-neutral-600 leading-relaxed">
          Servidor HTTP push
          <br />
          FW WS535BW1_BSCS v1.5.31
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center gap-4 px-6 py-3.5 border-b border-divider">
          <h4 className="m-0 text-[22px]">{titleFor(pathname)}</h4>
          <div className="ml-auto flex items-center gap-3.5 text-xs text-neutral-600">
            {activeOpsCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-accent-700">
                <span className="w-2 h-2 bg-accent animate-op-pulse" aria-hidden />
                {activeOpsCount === 1
                  ? "1 operación en curso"
                  : `${activeOpsCount} operaciones en curso`}
              </span>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </main>
      </div>
    </ToastProvider>
  );
}
