import { cx } from "@/lib/cx";
import type { ReactNode } from "react";

const CORNER_COLOR: Record<"accent" | "accent2", string> = {
  accent: "border-accent",
  accent2: "border-accent2",
};

/**
 * `corner` reemplaza al `blueprint` booleano anterior: la maqueta del
 * sistema nuevo dibuja solo 2 esquinas (arriba-izq + abajo-der, no las 4) en
 * el color de la métrica que representan (StatCard), no un gris fijo — así
 * que ahora hace falta el color, no solo "prenderlo o no".
 */
export function Card({
  corner,
  className,
  children,
}: {
  corner?: "accent" | "accent2";
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cx("relative flex flex-col gap-2 p-3 bg-surface border border-neutral-400", className)}>
      {corner && <Corners tone={corner} />}
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("m-0 flex-1 text-sm opacity-80", className)}>{children}</p>;
}

const KICKER_TONE: Record<"accent" | "accent2", string> = {
  accent: "text-accent-700",
  accent2: "text-accent2-700",
};

export function CardKicker({
  tone = "accent",
  className,
  children,
}: {
  tone?: "accent" | "accent2";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cx("font-mono text-2xs tracking-[0.16em] uppercase", KICKER_TONE[tone], className)}>
      {children}
    </span>
  );
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx("font-heading font-semibold text-lg leading-tight tracking-tight", className)}>
      {children}
    </span>
  );
}

export function CardMeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx("flex items-center gap-1.5 text-xs text-neutral-700", className)}>{children}</span>
  );
}

/** Las 2 marcas de esquina en L, en el color de `tone` — ver nota de arriba. */
function Corners({ tone }: { tone: "accent" | "accent2" }) {
  const color = CORNER_COLOR[tone];
  return (
    <>
      <span
        className={cx("absolute -top-px -left-px w-[8px] h-[8px] border-t-2 border-l-2", color)}
        aria-hidden
      />
      <span
        className={cx("absolute -bottom-px -right-px w-[8px] h-[8px] border-b-2 border-r-2", color)}
        aria-hidden
      />
    </>
  );
}
