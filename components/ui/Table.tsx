import Link from "next/link";
import { cx } from "@/lib/cx";
import type { ReactNode, TableHTMLAttributes } from "react";

export function Table({
  className,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  // El wrapper con scroll horizontal es lo que evita que una tabla ancha
  // (muchas columnas) rompa el layout en pantallas de teléfono — el <table>
  // no se achica, se desplaza dentro de su propia caja. bg-surface + borde
  // propio: la tabla es su propia caja "flotando" sobre bg, como el resto
  // del sistema nuevo.
  return (
    <div className="w-full overflow-x-auto bg-surface border border-neutral-400">
      <table className={cx("w-full min-w-[560px] border-collapse text-sm", className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <th
      className={cx(
        "text-left font-mono text-2xs tracking-[0.14em] uppercase text-neutral-700 whitespace-nowrap",
        "p-2 bg-chrome border-b border-neutral-400",
        className
      )}
    >
      {children}
    </th>
  );
}

/**
 * `actions`: la celda contiene botones propios (editar, desactivar…) — se pone
 * por encima del link estirado de la fila (ver RowLink) para que un clic en
 * un ícono haga su acción y no navegue al detalle.
 */
export function Td({
  className,
  children,
  actions,
  colSpan,
}: {
  className?: string;
  children?: ReactNode;
  actions?: boolean;
  colSpan?: number;
}) {
  return (
    <td colSpan={colSpan} className={cx("p-2 border-b border-neutral-200", actions && "relative z-10", className)}>
      {children}
    </td>
  );
}

/**
 * Fila de tabla. `clickable`: la fila entera navega al detalle — requiere un
 * `<RowLink>` en alguna celda (docs/11 U3). Matches .table tbody tr:hover.
 */
export function Tr({ className, children, clickable }: { className?: string; children: ReactNode; clickable?: boolean }) {
  return (
    <tr className={cx("hover:bg-accent-100", clickable && "relative cursor-pointer focus-within:bg-accent-100", className)}>
      {children}
    </tr>
  );
}

/**
 * Link real que cubre toda la fila (patrón "stretched link", docs/11 U3): el
 * `::after` absoluto ocupa el `<tr clickable>` entero. Es un `<a>` de verdad —
 * conserva clic medio, Ctrl/⌘+clic y navegación con teclado, a diferencia de
 * un `onClick` en el `<tr>`. Va en la celda principal (normalmente la primera).
 */
export function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={cx(
        "text-text no-underline hover:underline focus-visible:outline-none",
        "after:absolute after:inset-0 after:content-['']",
        className
      )}
    >
      {children}
    </Link>
  );
}
