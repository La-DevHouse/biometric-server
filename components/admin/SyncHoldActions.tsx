"use client";

import { useTransition } from "react";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { resolveSyncHoldAction } from "@/app/admin/actions";

/**
 * Aprobar o rechazar un freno de borrado masivo (docs/10 R8 / §4.5). Al
 * aprobar, cada baja se re-valida contra el alcance actual antes de borrar.
 */
export function SyncHoldActions({ holdId }: { holdId: number }) {
  const [pending, start] = useTransition();
  const { push } = useToast();

  function run(approve: boolean) {
    start(async () => {
      const r = await resolveSyncHoldAction(holdId, approve);
      push(r.ok ? "ok" : "error", r.ok ? r.message ?? "Listo." : r.error ?? "No se pudo.");
    });
  }

  return (
    <span className="flex gap-2">
      <Btn variant="primary" disabled={pending} onClick={() => run(true)}>
        Aprobar bajas
      </Btn>
      <Btn variant="secondary" disabled={pending} onClick={() => run(false)}>
        Rechazar
      </Btn>
    </span>
  );
}
