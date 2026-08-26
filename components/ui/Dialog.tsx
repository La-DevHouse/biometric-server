"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Native <dialog> gives focus trapping and Esc-to-close for free. Backdrop
 * click closes too, detected by checking the click landed on the <dialog>
 * element itself (its ::backdrop-adjacent padding box), not on a child.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
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
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
      className="backdrop:bg-text/40 border border-divider bg-bg p-0 w-full max-w-md shadow-lg m-auto"
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-lg m-0">{title}</h3>
          <button
            type="button"
            aria-label="Cerrar"
            className="text-text/50 hover:text-text cursor-pointer bg-transparent border-none text-lg leading-none p-0"
            onClick={() => ref.current?.close()}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
