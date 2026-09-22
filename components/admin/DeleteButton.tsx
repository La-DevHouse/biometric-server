"use client";

import { useState, useTransition } from "react";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
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
    return <IconBtn icon={Icon.trash} label={`Eliminar ${label}`} tone="danger" onClick={() => setConfirming(true)} />;
  }
  return (
    <span className="inline-flex items-center gap-1.5">
      <IconBtn icon={Icon.check} label={`Confirmar: eliminar ${label}`} tone="danger" disabled={pending} onClick={run} />
      <IconBtn icon={Icon.close} label="Cancelar" onClick={() => setConfirming(false)} />
    </span>
  );
}
