"use client";

import { useState, useTransition } from "react";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
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
    return <IconBtn icon={Icon.unlink} label="Desvincular" tone="danger" onClick={() => setConfirming(true)} />;
  return (
    <span className="inline-flex items-center gap-1.5">
      <IconBtn icon={Icon.check} label="Confirmar desvinculación" tone="danger" disabled={pending} onClick={run} />
      <IconBtn icon={Icon.close} label="Cancelar" onClick={() => setConfirming(false)} />
    </span>
  );
}
