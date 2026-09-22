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

export function Td({ className, children }: { className?: string; children: ReactNode }) {
  return <td className={cx("p-2 border-b border-neutral-200", className)}>{children}</td>;
}

/** Matches .table tbody tr:hover from the design. */
export function Tr({ className, children }: { className?: string; children: ReactNode }) {
  return <tr className={cx("hover:bg-accent-100", className)}>{children}</tr>;
}
