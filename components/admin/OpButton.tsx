"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import type { OpActionState } from "@/lib/opActionState";

type OpAction = (prev: OpActionState, formData: FormData) => Promise<OpActionState>;

/** Un click, sin más input que campos ocultos — bloquea en un diálogo propio hasta que resuelve. */
export function OpButton({
  action,
  hidden,
  title,
  children,
  variant = "secondary",
}: {
  action: OpAction;
  hidden: Record<string, string>;
  /** Título del diálogo que se abre al hacer click — separado de `children` porque el <dialog> lo exige como string. */
  title: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const { formAction, startError, op, busy, reset } = useOperation(action);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Btn variant={variant} onClick={() => setOpen(true)}>
        {children}
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title={title}>
        <div className="flex flex-col gap-3">
          {!op && (
            <form action={formAction}>
              {Object.entries(hidden).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {startError && <p className="text-sm m-0 text-text mb-2">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy}>
                {busy ? "Enviando…" : "Confirmar"}
              </Btn>
            </form>
          )}
          {op && !op.isTerminal && <OperationProgress op={op} />}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
