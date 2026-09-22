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
      <summary className="flex items-center gap-2 cursor-pointer select-none px-3 py-2.5 bg-chrome hover:bg-neutral-200 list-none [&::-webkit-details-marker]:hidden">
        <span className="inline-block text-2xs text-accent transition-transform duration-150 group-open:rotate-90" aria-hidden>
          ▶
        </span>
        <span className="font-mono text-2xs font-semibold uppercase tracking-[0.14em]">{title}</span>
        <span className="font-mono text-2xs uppercase tracking-[0.1em] text-neutral-700">opcional</span>
        {fieldCount != null && (
          <span className="ml-auto font-mono text-2xs text-neutral-700 group-open:hidden">
            {fieldCount} campo{fieldCount === 1 ? "" : "s"}
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-2 p-3 border-t border-divider">{children}</div>
    </details>
  );
}
