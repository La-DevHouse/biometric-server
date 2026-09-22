import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Reemplazo de una fila de `<Table>` en mobile — donde una tabla de 5+
 * columnas queda ilegible por más scroll horizontal que tenga. Cada
 * `<Table>` de una lista se acompaña de un `<MobileList>` de estos,
 * mostrando uno u otro según el ancho (`hidden md:block` / `md:hidden`).
 */
export function MobileList({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("flex flex-col gap-2.5 md:hidden", className)}>{children}</div>;
}

const ACCENT_BORDER: Record<"accent" | "accent2" | "neutral", string> = {
  accent: "border-l-accent",
  accent2: "border-l-accent2",
  neutral: "border-l-neutral-400",
};

export function MobileRow({
  title,
  href,
  tags,
  fields,
  actions,
  accent = "accent",
}: {
  title: ReactNode;
  /** Si se pasa, el título entero es un link (patrón "Detalle →" de la tabla). */
  href?: string;
  tags?: ReactNode;
  fields?: { label: string; value: ReactNode }[];
  actions?: ReactNode;
  /** Color del borde izquierdo de 3px — la maqueta lo usa como indicador de estado (default "accent" = activo). */
  accent?: "accent" | "accent2" | "neutral";
}) {
  const titleEl = href ? (
    <Link href={href} className="text-lg font-semibold text-text no-underline hover:underline">
      {title}
    </Link>
  ) : (
    <span className="text-lg font-semibold">{title}</span>
  );

  return (
    <div
      className={cx(
        "flex flex-col gap-2.5 bg-surface border border-neutral-400 border-l-[3px] p-3.5",
        ACCENT_BORDER[accent]
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {titleEl}
        {tags && <span className="flex flex-wrap items-center gap-1.5">{tags}</span>}
      </div>
      {fields && fields.length > 0 && (
        <dl className="flex flex-col gap-1.5 text-sm">
          {fields.map((f, i) => (
            <div key={i} className="flex items-baseline justify-between gap-3">
              <dt className="font-mono text-2xs uppercase tracking-[0.08em] text-neutral-700">{f.label}</dt>
              <dd className="m-0 text-right">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {actions && (
        <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-2.5">
          {actions}
        </div>
      )}
    </div>
  );
}
