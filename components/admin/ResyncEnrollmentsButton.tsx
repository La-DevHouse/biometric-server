"use client";

import { useTransition } from "react";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { resyncCompanyEnrollmentsAction } from "@/app/admin/empresas/actions";

/**
 * Re-sincroniza los enrolamientos que alcanzan los equipos de esta empresa
 * (contratos en ella, o en su grupo si comparte empleados): encola a cada
 * persona en los equipos de su alcance donde falte. Reparación manual del
 * fan-out — ver resyncCompanyEnrollmentsAction.
 */
export function ResyncEnrollmentsButton({ companyId }: { companyId: number }) {
  const [pending, start] = useTransition();
  const { push } = useToast();

  return (
    <IconBtn
      icon={Icon.sync}
      label="Re-sincronizar enrolamientos"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await resyncCompanyEnrollmentsAction(companyId);
          push(r.ok ? "ok" : "error", r.ok ? r.message ?? "Listo." : r.error ?? "No se pudo.");
        })
      }
    />
  );
}
