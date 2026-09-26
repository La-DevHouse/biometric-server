"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Native <dialog> gives focus trapping and Esc-to-close for free. Backdrop
 * click closes too, detected by checking the click landed on the <dialog>
 * element itself (its ::backdrop-adjacent padding box), not on a child.
 *
 * `closable = false` locks the dialog open while something is in progress —
 * no ×, no Esc, no backdrop click — so a blocking operation can't be
 * dismissed halfway through and silently lost track of. The caller is
 * responsible for offering its own way out once the operation resolves
 * (a "Cerrar" button is the usual shape, not this component's job).
 */
export function Dialog({
  open,
  onClose,
  title,
  closable = true,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closable?: boolean;
  /**
   * Franja fija al fondo (fuera del scroll del body) — el lugar estándar
   * para el botón de submit de un form largo, para que nunca quede fuera
   * de vista. El botón vive afuera del <form> (que sigue arriba, con los
   * campos) y se conecta con el atributo HTML `form="<id>"`.
   */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const handleClose = () => onClose();
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        if (!closable) e.preventDefault();
      }}
      onClick={(e) => {
        if (closable && e.target === ref.current) ref.current?.close();
      }}
      className={cx(
        // display:flex SOLO cuando `[open]` está presente — si no, gana sobre
        // el `dialog:not([open]){display:none}` del user-agent (una clase de
        // autor siempre le gana a la hoja del navegador, sin importar
        // especificidad) y el diálogo queda "cerrado" pero ocupando layout e
        // interceptando clicks igual.
        "hidden open:flex flex-col",
        "backdrop:bg-text/40 bg-surface p-0 max-w-none",
        // Alto = el del contenido, con tope: un diálogo de una línea no se
        // estira a toda la pantalla (antes, debajo de sm, era h-dvh fijo y un
        // confirm corto quedaba como una hoja en blanco). Un form largo llega
        // al tope y hace scroll en el body, con header y footer fijos.
        // dvh, no vh: mismo motivo que AdminShell — 100vh no descuenta la
        // barra de direcciones dinámica en mobile.
        // h-fit, NO h-auto: el <dialog> modal del user-agent es
        // position:fixed con top:0 y bottom:0 — con height:auto se estira a
        // todo el alto disponible (hasta el max-h). El UA trae
        // height:fit-content justamente por eso; h-fit lo restablece.
        "m-auto h-fit border border-text shadow-hard",
        "w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)]",
        "sm:w-[min(92vw,28rem)] sm:max-h-[85dvh]"
      )}
    >
      <div className="flex items-center justify-between p-4 border-b border-divider bg-chrome flex-none">
        <h3 className="font-heading text-xl font-semibold tracking-tight m-0">{title}</h3>
        {closable && (
          <button
            type="button"
            aria-label="Cerrar"
            className="w-7 h-7 flex-none flex items-center justify-center text-lg leading-none cursor-pointer bg-transparent border border-neutral-500 hover:border-text"
            onClick={() => ref.current?.close()}
          >
            ×
          </button>
        )}
      </div>
      <div className="flex flex-col gap-3 p-4 flex-1 min-h-0 overflow-y-auto">{children}</div>
      {footer && <div className="flex-none border-t border-divider bg-chrome p-4">{footer}</div>}
    </dialog>
  );
}
