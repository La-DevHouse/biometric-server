"use client";

import { useId, useState, type ReactNode } from "react";
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
  label,
  children,
  variant = "secondary",
}: {
  action: OpAction;
  hidden: Record<string, string>;
  /** Título del diálogo que se abre al hacer click — separado de `children` porque el <dialog> lo exige como string. */
  title: string;
  /** Tooltip/aria-label del botón trigger, si es distinto del título (ej. variant="icon"). Por defecto usa `title`. */
  label?: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const { formAction, startError, op, busy, reset } = useOperation(action);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Btn variant={variant} title={label ?? title} aria-label={label ?? title} onClick={() => setOpen(true)}>
        {children}
      </Btn>
      <Dialog
        open={open}
        onClose={close}
        closable={!busy}
        title={title}
        footer={
          !op && (
            <Btn type="submit" form={formId} variant="primary" disabled={busy}>
              {busy ? "Enviando…" : "Confirmar"}
            </Btn>
          )
        }
      >
        <div className="flex flex-col gap-3">
          {!op && (
            <form id={formId} action={formAction}>
              {Object.entries(hidden).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {startError && <p className="text-sm m-0 text-text mb-2">{startError}</p>}
            </form>
          )}
          {op && !op.isTerminal && <OperationProgress op={op} />}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
