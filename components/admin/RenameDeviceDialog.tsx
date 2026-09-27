"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useOperation } from "./useOperation";
import { renameDeviceAction } from "@/app/admin/actions";
import { FIELD_INPUT as INPUT_CLASS } from "@/components/ui/fieldStyles";

export function RenameDeviceDialog({ devId, currentName }: { devId: string; currentName: string }) {
  const [open, setOpen] = useState(false);
  const { formAction, startError, busy } = useOperation(renameDeviceAction, { onStarted: close });

  function close() {
    setOpen(false);
  }

  return (
    <>
      <IconBtn icon={Icon.edit} label="Renombrar" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={close} closable={!busy} title="Renombrar equipo">
        <div className="flex flex-col gap-3">
          <form action={formAction} className="flex flex-col gap-3">
            <input type="hidden" name="dev_id" value={devId} />
            <label className="flex flex-col gap-1 text-xs text-text/85">
              Nombre nuevo
              <input
                type="text"
                name="fk_name"
                required
                defaultValue={currentName}
                className={INPUT_CLASS}
                autoFocus
              />
            </label>
            <p className="text-xs text-text/70 m-0">
              El nombre se actualiza cuando el equipo confirma el cambio en su próximo reporte
              (hasta ~10s) — no se muestra de forma optimista.
            </p>
            {startError && <p className="text-sm m-0 text-text">{startError}</p>}
            <Btn type="submit" variant="primary" disabled={busy}>
              {busy ? "Enviando…" : "Renombrar"}
            </Btn>
          </form>
        </div>
      </Dialog>
    </>
  );
}
