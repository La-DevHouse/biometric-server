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
      className="w-full flex flex-col items-center gap-[7px] p-[30px] max-md:px-[16px] max-md:py-[28px] max-md:gap-[8px] text-center border border-dashed border-neutral-500 bg-[repeating-linear-gradient(135deg,#fff_0px,#fff_6px,#f6f7f8_6px,#f6f7f8_12px)]"
    >
      <p className="m-0 font-heading text-lg font-semibold leading-tight">{title}</p>
      {description && <p className="m-0 text-xs text-neutral-800 max-w-md">{description}</p>}
      {action && <div className="mt-[8px] max-md:w-full">{action}</div>}
    </div>
  );
}
