import { cx } from "@/lib/cx";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-1.5 cursor-pointer no-underline " +
  "font-heading font-semibold text-sm leading-tight " +
  "border rounded-none " +
  "px-4 py-2 " +
  "disabled:bg-neutral-200 disabled:text-neutral-600 disabled:border-neutral-300 disabled:cursor-not-allowed disabled:hover:bg-neutral-200";

// Border-radius:0 on every variant matches the "blueprint" square-corner
// language of the rest of the system (Card, Table, Tag, Dialog — nada tiene
// esquina redonda en ningún lado).
const VARIANT: Record<Variant, string> = {
  // Primary: fondo tinta (no accent) — el azul queda reservado para hover y
  // para los estados "activo"/link. Invierte a accent en hover, no a un
  // negro más oscuro.
  primary: "bg-text text-white border-text hover:bg-accent hover:border-accent active:bg-accent-700 active:border-accent-700",
  secondary: "bg-surface text-text border-text hover:bg-text hover:text-white active:bg-neutral-800 active:border-neutral-800",
  ghost: "bg-transparent text-neutral-800 border-transparent hover:bg-neutral-200 hover:text-text active:bg-neutral-300",
  icon: "w-9 h-9 p-0 bg-surface text-text border-neutral-500 hover:border-text text-xl",
};

interface CommonProps {
  variant?: Variant;
  block?: boolean;
  className?: string;
  children: ReactNode;
}

function buildClasses(props: CommonProps): string {
  return cx(BASE, VARIANT[props.variant ?? "secondary"], props.block && "w-full mt-1.5", props.className);
}

/** A real, clickable action — renders a <button>. */
export function Btn({
  variant,
  block,
  className,
  children,
  ...rest
}: CommonProps & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">) {
  return (
    <button className={buildClasses({ variant, block, className, children })} {...rest}>
      {children}
    </button>
  );
}

/** A navigational action — renders a Next <Link>. */
export function LinkBtn({
  href,
  variant,
  block,
  className,
  children,
}: CommonProps & { href: string }) {
  return (
    <Link href={href} className={buildClasses({ variant, block, className, children })}>
      {children}
    </Link>
  );
}

/**
 * A button/link for an action that isn't wired up yet (Fase 3). Rendered
 * inert rather than as a real interactive element, matching what a real
 * `<button disabled>` communicates. Span, not a real disabled attribute, so
 * the disabled: pseudo-classes from BASE don't apply — same flat colors
 * spelled out directly instead.
 */
export function DisabledBtn({
  variant,
  block,
  className,
  children,
  title,
}: CommonProps & { title?: string }) {
  return (
    <span
      className={cx(
        buildClasses({ variant, block, className, children }),
        "bg-neutral-200! text-neutral-600! border-neutral-300! cursor-not-allowed"
      )}
      aria-disabled="true"
      title={title}
    >
      {children}
    </span>
  );
}
