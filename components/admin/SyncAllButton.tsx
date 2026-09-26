"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useMultiOperation } from "./useOperation";
import { syncAllDevicesAction } from "@/app/admin/actions";

/** "Sincronizar todos": una corrida del reconciliador por equipo asignado; el avance va al panel "Procesando". */
export function SyncAllButton() {
  const [open, setOpen] = useState(false);
  const { formAction, startError, busy } = useMultiOperation(syncAllDevicesAction, { onStarted: () => setOpen(false) });

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Sincronizar todos
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} closable={!busy} title="Sincronizar huellas en todos los equipos">
        <form action={formAction} className="flex flex-col gap-3">
          <p className="text-sm m-0">
            Revisa cada equipo asignado a una sede: agrega a quien falte, copia las huellas que falten y
            quita a quien ya no corresponda (nunca admins ni IDs que no sean de un empleado; si serían
            muchas bajas, se frenan y piden aprobación).
          </p>
          <p className="text-xs text-text/70 m-0">Corre en segundo plano; el avance aparece en el panel “Procesando”.</p>
          {startError && <p className="text-sm m-0 text-text">{startError}</p>}
          <Btn type="submit" variant="primary" disabled={busy}>
            {busy ? "Enviando…" : "Sincronizar todos"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
