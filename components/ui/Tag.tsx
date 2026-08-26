import { cx } from "@/lib/cx";
import type { ReactNode } from "react";

type TagVariant = "accent" | "accent2" | "neutral" | "outline";

// Same border-radius:0 override as Card/Btn — see Card.tsx's note.
const VARIANT: Record<TagVariant, string> = {
  accent: "bg-accent-100 text-accent-800",
  accent2: "bg-accent2-100 text-accent2-800",
  neutral: "bg-neutral-100 text-neutral-800",
  outline: "border border-accent text-accent",
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
        "inline-flex items-center text-[11px] tracking-[0.02em] px-[10px] py-[3px] rounded-none",
        VARIANT[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
