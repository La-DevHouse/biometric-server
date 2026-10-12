"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import { renameDeviceAction } from "@/app/admin/dispositivos/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT_CLASS } from "@/components/ui/fieldStyles";

/**
 * Nombre del equipo en el panel (devices.name). No toca el equipo: su nombre
 * interno (fk_name) es su serial y no se cambia desde acá (lib/deviceIdentity).
 */
export function RenameDeviceDialog({ devId, currentName }: { devId: string; currentName: string | null }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(renameDeviceAction, ADMIN_ACTION_INITIAL);
  const onSubmit = useFormSubmit(formAction, state);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      <IconBtn icon={Icon.edit} label="Renombrar" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} closable={!pending} title="Renombrar equipo">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <label className="flex flex-col gap-1 text-xs text-text/85">
            Nombre en el panel
            <input
              type="text"
              name="name"
              maxLength={120}
              defaultValue={currentName ?? ""}
              placeholder={devId}
              className={INPUT_CLASS}
              autoFocus
            />
          </label>
          <p className="text-xs text-text/70 m-0">
            Solo cambia cómo se ve en el panel. El equipo conserva su serial ({devId}) como nombre
            interno; vacío = se muestra el serial.
          </p>
          <Btn type="submit" variant="primary" disabled={pending}>
            {pending ? "Guardando…" : "Guardar"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
