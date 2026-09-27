import Link from "next/link";
import { cx } from "@/lib/cx";

export interface TabItem {
  key: string;
  label: string;
  href: string;
}

/**
 * Pestañas por ruta (docs/11 U1): cada pestaña es una subruta, así se puede
 * enlazar, recargar y usar "atrás" del navegador. La primera es siempre
 * "Información" en los detalles de Empresa / Empleado / Equipo.
 */
export function Tabs({ items, active, label }: { items: TabItem[]; active: string; label: string }) {
  return (
    // Scroll solo horizontal (mobile, pestañas que no entran) y sin barra visible.
    // La línea de base es una sombra interna, no border-b + -mb-px en cada
    // pestaña: ese píxel que "sobresalía" generaba también scroll vertical.
    <nav
      className="flex gap-1 overflow-x-auto overflow-y-hidden overscroll-x-contain shadow-[inset_0_-1px_0_var(--color-divider)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      aria-label={label}
    >
      {items.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          aria-current={t.key === active ? "page" : undefined}
          className={cx(
            "flex-none whitespace-nowrap border-b-2 px-[14px] py-[10px] max-md:py-[12px] text-sm font-medium no-underline",
            t.key === active ? "border-text font-semibold text-text" : "border-transparent text-text/70 hover:text-text"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Encabezado estándar de un detalle (docs/11 U1): volver, nombre, insignias de
 * estado y, a la derecha, las acciones como íconos con tooltip.
 */
export function DetailHeader({
  backHref,
  backLabel,
  title,
  subtitle,
  badges,
  actions,
}: {
  backHref: string;
  backLabel: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badges?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <Link href={backHref} className="self-start text-xs font-semibold text-accent-700 no-underline hover:underline">
        ← {backLabel}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h2 className="m-0 font-heading text-2xl font-semibold tracking-[-0.02em]">{title}</h2>
          {badges}
          {subtitle && <span className="text-sm text-text/70">{subtitle}</span>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
      </div>
    </div>
  );
}
