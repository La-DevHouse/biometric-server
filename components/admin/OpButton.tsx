"use client";

import { useActionState, useEffect, type ReactNode } from "react";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { OP_ACTION_INITIAL, type OpActionState } from "@/lib/opActionState";

type OpAction = (prev: OpActionState, formData: FormData) => Promise<OpActionState>;

/** A single-click operation that needs no extra input beyond hidden fields. */
export function OpButton({
  action,
  hidden,
  children,
  variant = "secondary",
}: {
  action: OpAction;
  hidden: Record<string, string>;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
}) {
  const [state, formAction, isPending] = useActionState(action, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push(state.warning ? "warn" : "ok", state.warning || "Operación encolada.");
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  return (
    <form action={formAction} className="inline">
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Btn type="submit" variant={variant} disabled={isPending}>
        {isPending ? "Encolando…" : children}
      </Btn>
    </form>
  );
}
