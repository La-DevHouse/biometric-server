import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Btn } from "./Btn";

/**
 * Botón-ícono con tooltip (docs/11 U2: íconos con tooltip son la norma para
 * las acciones). Alcanza con un `label`: de ahí salen el tooltip visible y el
 * nombre accesible, así no hay forma de poner uno y olvidarse del otro.
 *
 * El tooltip es propio (no el `title` nativo): aparece al instante con hover
 * O con foco de teclado, y no duplica el `title` del navegador. `tone="danger"`
 * es la única variación de color permitida (acciones destructivas) — no se abre
 * `className` libre a propósito, para no perder la consistencia del set.
 */
export function IconBtn({
  icon,
  label,
  tone,
  tooltipSide = "top",
  ...rest
}: {
  icon: ReactNode;
  label: string;
  tone?: "danger";
  /** Dónde aparece el tooltip; "bottom" para barras pegadas al borde superior. */
  tooltipSide?: "top" | "bottom";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title" | "aria-label">) {
  return (
    <span className="group/tip relative inline-flex">
      <Btn
        variant="icon"
        aria-label={label}
        className={cx(tone === "danger" && "text-danger-600! hover:border-danger-600!")}
        {...rest}
      >
        {icon}
      </Btn>
      <Tip label={label} side={tooltipSide} />
    </span>
  );
}

/** El globo del tooltip — también lo usan links-ícono que no son <button>. */
export function Tip({ label, side = "top" }: { label: string; side?: "top" | "bottom" }) {
  return (
    <span
      role="tooltip"
      aria-hidden
      className={cx(
        "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap",
        "border border-text bg-text px-2 py-1 font-sans text-xs font-normal text-white shadow-hard",
        "opacity-0 transition-opacity duration-100 delay-150",
        "group-hover/tip:opacity-100 group-focus-within/tip:opacity-100",
        side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5"
      )}
    >
      {label}
    </span>
  );
}
