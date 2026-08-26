import { cx } from "@/lib/cx";
import type { ReactNode, TableHTMLAttributes } from "react";

export function Table({
  className,
  children,
  ...rest
}: TableHTMLAttributes<HTMLTableElement> & { children: ReactNode }) {
  return (
    <table className={cx("w-full border-collapse text-sm", className)} {...rest}>
      {children}
    </table>
  );
}

export function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <th
      className={cx(
        "text-left text-[11px] tracking-[0.08em] uppercase text-text/60",
        "p-2 border-b border-divider",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({ className, children }: { className?: string; children: ReactNode }) {
  return <td className={cx("p-2 border-b border-text/8", className)}>{children}</td>;
}

/** Matches .table tbody tr:hover from the design. */
export function Tr({ className, children }: { className?: string; children: ReactNode }) {
  return <tr className={cx("hover:bg-text/4", className)}>{children}</tr>;
}
