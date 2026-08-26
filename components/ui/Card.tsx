import { cx } from "@/lib/cx";
import type { ReactNode } from "react";

/**
 * The design's resolved "blueprint" cascade for .card: a later, unscoped
 * rule (`.card, .btn, .input, .tag, .seg, .dialog { border-radius: 0; }`
 * plus `.card, .dialog { background: transparent; border: 1px solid
 * var(--color-divider); }`) overrides the earlier rounded/filled version —
 * square corners, transparent fill, hairline border is the actual
 * rendered look, not the rounded-surface rule defined above it in the
 * source. Reproduced directly rather than the superseded rule.
 */
export function Card({
  blueprint,
  className,
  children,
}: {
  blueprint?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "relative flex flex-col gap-2 p-3 border border-divider",
        className
      )}
    >
      {blueprint && <Corners />}
      {children}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cx("m-0 flex-1 text-[13px] opacity-80", className)}>{children}</p>;
}

export function CardKicker({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "text-[10px] tracking-[0.1em] uppercase text-accent",
        className
      )}
    >
      {children}
    </span>
  );
}

export function CardTitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span className={cx("font-heading text-[17px] leading-tight", className)}>{children}</span>
  );
}

export function CardMeta({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        "flex items-center gap-1.5 text-[11px] text-text/50",
        className
      )}
    >
      {children}
    </span>
  );
}

/** The 4 blueprint registration-mark corners; see globals.css for the CSS. */
function Corners() {
  return (
    <>
      <span className="blueprint-corner blueprint-corner-tl" aria-hidden />
      <span className="blueprint-corner blueprint-corner-tr" aria-hidden />
      <span className="blueprint-corner blueprint-corner-bl" aria-hidden />
      <span className="blueprint-corner blueprint-corner-br" aria-hidden />
    </>
  );
}
