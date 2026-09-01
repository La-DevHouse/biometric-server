"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";

/** Botón de borrado con confirmación en dos pasos. */
export function DeleteButton({
  id,
  label,
  action,
}: {
  id: number;
  label: string; // ej. "turno"
  action: (id: number) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { push } = useToast();

  function run() {
    start(async () => {
      const res = await action(id);
      if (res.ok) push("ok", `${label[0].toUpperCase()}${label.slice(1)} eliminado.`);
      else push("error", res.error ?? "No se pudo eliminar.");
      setConfirming(false);
    });
  }

  if (!confirming) {
    return (
      <Btn variant="ghost" onClick={() => setConfirming(true)}>
        Eliminar
      </Btn>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Btn variant="secondary" disabled={pending} onClick={run}>
        {pending ? "…" : `Eliminar ${label}`}
      </Btn>
      <Btn variant="ghost" onClick={() => setConfirming(false)}>
        Cancelar
      </Btn>
    </span>
  );
}
