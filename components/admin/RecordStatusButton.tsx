"use client";

import { useState, useTransition } from "react";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";

/**
 * Botón de activar/desactivar (soft-delete) genérico. `action` recibe
 * (id, active) y devuelve { ok, error? }. Reusado por empresas y sedes.
 */
export function RecordStatusButton({
  id,
  active,
  label,
  action,
}: {
  id: number;
  active: boolean;
  label: string; // ej. "empresa", "sede"
  action: (id: number, active: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const { push } = useToast();

  function run(next: boolean) {
    startTransition(async () => {
      const res = await action(id, next);
      if (res.ok) push("ok", next ? `${cap(label)} reactivada.` : `${cap(label)} desactivada.`);
      else push("error", res.error ?? "No se pudo completar.");
      setConfirming(false);
    });
  }

  if (active) {
    return confirming ? (
      <span className="inline-flex items-center gap-1.5">
        <IconBtn
          icon={Icon.check}
          label={`Confirmar: desactivar ${label}`}
          tone="danger"
          disabled={pending}
          onClick={() => run(false)}
        />
        <IconBtn icon={Icon.close} label="Cancelar" onClick={() => setConfirming(false)} />
      </span>
    ) : (
      <IconBtn icon={Icon.power} label={`Desactivar ${label}`} tone="danger" onClick={() => setConfirming(true)} />
    );
  }

  return <IconBtn icon={Icon.power} label={`Reactivar ${label}`} disabled={pending} onClick={() => run(true)} />;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
