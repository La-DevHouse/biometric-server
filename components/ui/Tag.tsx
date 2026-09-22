import { cx } from "@/lib/cx";
import type { ReactNode } from "react";

type TagVariant = "accent" | "accent2" | "neutral" | "outline";

// Mono + uppercase + borde propio por estado, en vez del pill sólido sin
// borde de antes.
const VARIANT: Record<TagVariant, string> = {
  accent: "border border-accent text-accent-700 bg-accent-100",
  accent2: "border border-accent2 text-accent2-700 bg-accent2-100",
  neutral: "border border-neutral-500 text-neutral-800 bg-surface",
  outline: "border border-dashed border-neutral-500 text-neutral-700 bg-transparent",
};

export function Tag({
  variant = "neutral",
  className,
  children,
}: {
  variant?: TagVariant;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center font-mono text-2xs uppercase tracking-[0.12em] px-[7px] py-[3px] rounded-none",
        VARIANT[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
