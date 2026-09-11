"use client";

import { useTransition } from "react";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { resyncGroupEnrollmentsAction } from "@/app/admin/empresas/actions";

/**
 * Re-sincroniza los enrolamientos del grupo: encola a cada persona con empleo
 * activo en los equipos del grupo donde falte. Reparación manual del fan-out.
 */
export function ResyncGroupButton({ companyId }: { companyId: number }) {
  const [pending, start] = useTransition();
  const { push } = useToast();

  return (
    <Btn
      variant="ghost"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await resyncGroupEnrollmentsAction(companyId);
          push(r.ok ? "ok" : "error", r.ok ? r.message ?? "Listo." : r.error ?? "No se pudo.");
        })
      }
    >
      {pending ? "Propagando…" : "Re-sincronizar grupo"}
    </Btn>
  );
}
