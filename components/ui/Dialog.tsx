"use client";

import { useEffect, useRef, type ReactNode } from "react";

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
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  closable?: boolean;
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
      className="backdrop:bg-text/40 border border-divider bg-bg p-0 w-full max-w-md shadow-lg m-auto"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-lg m-0">{title}</h3>
          {closable && (
            <button
              type="button"
              aria-label="Cerrar"
              className="text-text/70 hover:text-text cursor-pointer bg-transparent border-none text-lg leading-none p-0"
              onClick={() => ref.current?.close()}
            >
              ×
            </button>
          )}
        </div>
        {children}
      </div>
    </dialog>
  );
}
