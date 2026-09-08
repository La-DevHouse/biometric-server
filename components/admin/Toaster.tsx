"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

type ToastKind = "ok" | "warn" | "error";
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  push: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

let nextToastId = 1;

const KIND_LABEL: Record<ToastKind, string> = {
  ok: "Listo",
  warn: "Atención",
  error: "Error",
};

const KIND_CLASS: Record<ToastKind, string> = {
  ok: "border-accent",
  warn: "border-accent2",
  error: "border-text/40",
};

/**
 * Un mensaje a la vez, centrado, que exige un clic explícito para cerrarse —
 * nunca desaparece solo. Si llegan varios, se encolan y se muestran uno
 * después del otro, en vez de apilarse o pisarse entre sí.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<ToastItem[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const current = queue[0] ?? null;

  const push = useCallback((kind: ToastKind, message: string) => {
    setQueue((q) => [...q, { id: nextToastId++, kind, message }]);
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (current && !dialog.open) dialog.showModal();
    if (!current && dialog.open) dialog.close();
  }, [current]);

  function dismiss() {
    setQueue((q) => q.slice(1));
  }

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <dialog
        ref={dialogRef}
        onCancel={(e) => e.preventDefault()}
        className="backdrop:bg-text/40 border border-divider bg-bg p-0 w-full max-w-sm shadow-lg m-auto"
      >
        {current && (
          <div className={cx("flex flex-col gap-3 p-4 border-t-4", KIND_CLASS[current.kind])}>
            <h3 className="font-heading text-lg m-0">{KIND_LABEL[current.kind]}</h3>
            <p className="text-sm m-0 whitespace-pre-wrap">{current.message}</p>
            <button
              type="button"
              onClick={dismiss}
              className="self-end min-h-9 px-4 text-sm bg-accent text-bg border-none cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}
      </dialog>
    </ToastContext.Provider>
  );
}
