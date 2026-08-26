import { cx } from "@/lib/cx";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "icon";

const BASE =
  "inline-flex items-center justify-center gap-1.5 cursor-pointer no-underline " +
  "font-heading font-semibold text-sm leading-tight text-text " +
  "bg-transparent border border-divider rounded-none " +
  "px-4 py-2 disabled:opacity-45 disabled:cursor-not-allowed";

// Border-radius:0 and the hairline border on every variant come from the
// design's "blueprint" cascade overriding its own earlier rounded/filled
// button rule — see components/ui/Card.tsx's note on the same pattern.
const VARIANT: Record<Variant, string> = {
  primary: "bg-accent text-bg border-accent hover:bg-accent-600 active:bg-accent-700",
  secondary: "border-divider hover:bg-text/7 active:bg-text/14",
  ghost: "text-accent border-transparent px-1 hover:bg-accent/10 active:bg-accent/18",
  icon: "w-9 h-9 p-0",
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
 * `<button disabled>` communicates.
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
      className={cx(buildClasses({ variant, block, className, children }), "opacity-45 cursor-not-allowed")}
      aria-disabled="true"
      title={title}
    >
      {children}
    </span>
  );
}
