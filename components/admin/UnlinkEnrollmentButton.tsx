"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { endEnrollmentAction } from "@/app/admin/enrolamiento/actions";

/** Desvincula un enrolamiento activo, con confirmación en dos pasos. */
export function UnlinkEnrollmentButton({ id }: { id: number }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();

  function run() {
    start(async () => {
      const res = await endEnrollmentAction(id);
      if (res.ok) push("ok", "Vínculo finalizado.");
      else push("error", res.error ?? "No se pudo desvincular.");
      setConfirming(false);
    });
  }

  if (!confirming)
    return (
      <Btn variant="ghost" onClick={() => setConfirming(true)}>
        Desvincular
      </Btn>
    );
  return (
    <span className="inline-flex items-center gap-1">
      <Btn variant="secondary" disabled={pending} onClick={run}>
        {pending ? "…" : "Confirmar"}
      </Btn>
      <Btn variant="ghost" onClick={() => setConfirming(false)}>
        Cancelar
      </Btn>
    </span>
  );
}
