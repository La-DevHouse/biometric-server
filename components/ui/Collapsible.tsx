import type { ReactNode } from "react";

/**
 * Grupo de campos opcionales, colapsado por defecto — el estándar para
 * secciones opcionales dentro de un diálogo (Representante legal, Umbrales
 * de asistencia). `<details>` nativo: sin JS, sin estado, foco/teclado gratis
 * — el indicador "N campos" de la derecha (solo cerrado) y la rotación de la
 * flecha son puro CSS (`group-open:`), no requieren pasar a client component.
 */
export function Collapsible({
  title,
  fieldCount,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** "N campos" cuando está cerrado — puramente informativo, opcional. */
  fieldCount?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group border border-neutral-400 bg-surface" open={defaultOpen}>
      <summary className="flex items-center gap-[10px] cursor-pointer select-none px-[14px] py-[11px] max-md:px-[16px] max-md:py-[14px] bg-chrome hover:bg-[#eaedf0] list-none [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-2xs max-md:text-label text-accent transition-transform duration-150 group-open:rotate-90" aria-hidden>
          ▶
        </span>
        <span className="font-mono text-label font-semibold uppercase tracking-[0.14em] max-md:tracking-[0.1em]">{title}</span>
        <span className="font-mono text-2xs uppercase tracking-[0.08em] text-neutral-700 max-md:hidden">opcional</span>
        {fieldCount != null && (
          <span className="ml-auto font-mono text-2xs text-neutral-700 group-open:hidden">
            {fieldCount} campo{fieldCount === 1 ? "" : "s"}
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-[14px] px-[14px] py-[16px] max-md:p-[16px] max-md:gap-[12px] border-t border-neutral-300">{children}</div>
    </details>
  );
}
