import type { ReactNode } from "react";

/**
 * Fondo rayado diagonal + borde punteado — el mismo motivo "construcción/
 * placeholder" que usa el dropzone de subida de archivos, para que los dos
 * estados "todavía no hay nada acá" del sistema se vean como el mismo patrón.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="w-full flex flex-col items-center gap-2 p-[26px] text-center border border-dashed border-neutral-500 bg-[repeating-linear-gradient(135deg,#fff_0px,#fff_6px,#f6f7f8_6px,#f6f7f8_12px)]"
    >
      <p className="font-heading text-[17px] font-semibold leading-tight tracking-tight">{title}</p>
      {description && <p className="text-sm text-neutral-800 max-w-sm">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
