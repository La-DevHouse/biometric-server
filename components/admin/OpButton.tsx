"use client";

import { useId, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useOperation } from "./useOperation";
import type { OpActionState } from "@/lib/opActionState";

type OpAction = (prev: OpActionState, formData: FormData) => Promise<OpActionState>;

/**
 * Un click, sin más input que campos ocultos: confirma en un diálogo y lo
 * cierra apenas la operación queda encolada — el seguimiento pasa al panel
 * global "Procesando" (OperationsTracker), sin bloquear la interfaz.
 */
export function OpButton({
  action,
  hidden,
  title,
  label,
  description,
  children,
  variant = "secondary",
}: {
  action: OpAction;
  hidden: Record<string, string>;
  /** Título del diálogo que se abre al hacer click — separado de `children` porque el <dialog> lo exige como string. */
  title: string;
  /** Tooltip/aria-label del botón trigger, si es distinto del título (ej. variant="icon"). Por defecto usa `title`. */
  label?: string;
  /** Qué va a pasar, en una o dos líneas. Tiene un texto por defecto. */
  description?: ReactNode;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "icon";
}) {
  const [open, setOpen] = useState(false);
  const formId = useId();
  const { formAction, startError, busy } = useOperation(action, { onStarted: close });

  function close() {
    setOpen(false);
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
          <Btn type="submit" form={formId} variant="primary" disabled={busy}>
            {busy ? "Enviando…" : "Confirmar"}
          </Btn>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm m-0">
            {description ?? "Se envía al equipo en segundo plano: podés seguir usando el panel mientras se procesa."}
          </p>
          <p className="text-xs text-text/70 m-0">El avance y el resultado aparecen en el panel “Procesando”.</p>
          <form id={formId} action={formAction}>
            {Object.entries(hidden).map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {startError && <p className="text-sm m-0 text-text mb-2">{startError}</p>}
          </form>
        </div>
      </Dialog>
    </>
  );
}
