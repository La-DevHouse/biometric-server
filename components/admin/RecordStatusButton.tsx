"use client";

import { useState, useTransition } from "react";
import { Btn } from "@/components/ui/Btn";
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
        <Btn variant="secondary" disabled={pending} onClick={() => run(false)}>
          {pending ? "…" : `Desactivar ${label}`}
        </Btn>
        <Btn variant="ghost" onClick={() => setConfirming(false)}>
          Cancelar
        </Btn>
      </span>
    ) : (
      <Btn variant="ghost" onClick={() => setConfirming(true)}>
        Desactivar
      </Btn>
    );
  }

  return (
    <Btn variant="ghost" disabled={pending} onClick={() => run(true)}>
      {pending ? "…" : "Reactivar"}
    </Btn>
  );
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
