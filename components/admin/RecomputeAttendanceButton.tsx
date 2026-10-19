"use client";

import { useTransition } from "react";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { recomputeAttendanceAction } from "@/app/admin/empresas/[id]/asistencia/actions";

/**
 * "Recalcular asistencia" (docs/16): calcula los días de la empresa en el rango
 * filtrado (o los últimos días cerrados). El worker lo hace solo cada noche.
 */
export function RecomputeAttendanceButton({ companyId, from, to }: { companyId: number; from?: string; to?: string }) {
  const [pending, start] = useTransition();
  const { push } = useToast();
  const label =
    from && to ? "Recalcular asistencia del período filtrado" : "Recalcular asistencia de los últimos días";
  return (
    <IconBtn
      icon={Icon.refresh}
      label={pending ? "Calculando…" : label}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const r = await recomputeAttendanceAction(companyId, { from, to });
          push(r.ok ? "ok" : "error", r.ok ? r.message : r.error);
        })
      }
    />
  );
}
