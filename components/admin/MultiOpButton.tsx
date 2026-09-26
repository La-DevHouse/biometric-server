"use client";

import { useId, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useMultiOperation } from "./useOperation";
import type { MultiOpActionState } from "@/lib/opActionState";

type MultiOpAction = (prev: MultiOpActionState, formData: FormData) => Promise<MultiOpActionState>;

/**
 * Como OpButton, para acciones que encolan VARIAS operaciones (una por equipo):
 * confirma en un diálogo que se cierra al encolar; el avance va al panel
 * "Procesando" (OperationsTracker).
 */
export function MultiOpButton({
  action,
  hidden,
  title,
  description,
  children,
  variant = "secondary",
}: {
  action: MultiOpAction;
  hidden: Record<string, string>;
  title: string;
  description: ReactNode;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const { formAction, startError, busy } = useMultiOperation(action, { onStarted: () => setOpen(false) });

  return (
    <>
      <Btn variant={variant} onClick={() => setOpen(true)}>
        {children}
      </Btn>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closable={!busy}
        title={title}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? "Enviando…" : "Confirmar"}
          </Btn>
        }
      >
        <p className="text-sm m-0">{description}</p>
        <p className="text-xs text-text/70 m-0">Corre en segundo plano; el avance aparece en el panel “Procesando”.</p>
        <form id={formId} action={formAction}>
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {startError && <p className="text-sm m-0 text-text">{startError}</p>}
        </form>
      </Dialog>
    </>
  );
}
