import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Btn } from "./Btn";
import { Tip } from "./Tip";

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

// El globo vive en su propio componente cliente (posicionamiento fijo).
export { Tip };
