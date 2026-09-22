import type { ReactNode, ButtonHTMLAttributes } from "react";
import { cx } from "@/lib/cx";
import { Btn } from "./Btn";

/**
 * `<Btn variant="icon" title={label} aria-label={label}>{icon}</Btn>` — el
 * mismo trío de props repetido a mano en cada botón-ícono del panel (~15
 * veces). Acá alcanza con un `label`; el tooltip y el nombre accesible
 * salen de ahí solos, así no hay forma de tipear uno y olvidarse del otro.
 * `tone="danger"` es la única variación de color permitida (acciones
 * destructivas — Eliminar) — no se abre `className` libre a propósito, para
 * que no se pierda la consistencia del set de íconos.
 */
export function IconBtn({
  icon,
  label,
  tone,
  ...rest
}: {
  icon: ReactNode;
  label: string;
  tone?: "danger";
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "title" | "aria-label">) {
  return (
    <Btn
      variant="icon"
      title={label}
      aria-label={label}
      className={cx(tone === "danger" && "text-danger-600! hover:border-danger-600!")}
      {...rest}
    >
      {icon}
    </Btn>
  );
}
