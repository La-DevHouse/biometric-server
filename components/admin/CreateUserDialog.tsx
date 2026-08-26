"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { notifyOperationStarted } from "@/lib/opEvents";
import { createUserAction } from "@/app/admin/actions";
import { OP_ACTION_INITIAL } from "@/lib/opActionState";

const INPUT_CLASS = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function CreateUserDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [state, formAction, isPending] = useActionState(createUserAction, OP_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      notifyOperationStarted();
      push(
        state.warning ? "warn" : "ok",
        state.warning || "Creando usuario — puede tardar hasta 3 minutos mientras se confirma que el ID está libre."
      );
      setOpen(false);
      setName("");
    } else if (state.status === "error") {
      push("error", state.message);
    }
  }, [state, push]);

  const truncated = name.trim().slice(0, 8);
  const willTruncate = name.trim().length > 8;

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + Crear usuario nuevo
      </Btn>
      <Dialog open={open} onClose={() => setOpen(false)} title="Crear usuario nuevo">
        <p className="text-xs text-text/50 m-0">
          Solo para gente que todavía no existe en el equipo — registra su ID, nombre y privilegio.
          La huella se agrega después, físicamente en el dispositivo; si el ID ya existe, esto se
          niega a tocarlo (no sobreescribe ni "resetea" a nadie).
        </p>
        <p className="text-xs text-text/50 m-0">
          Puede tardar hasta 3 minutos: antes de crear, se confirma con el equipo que el ID esté
          realmente libre, y esa comprobación es lenta por diseño — es lo que evita arruinar las
          huellas de alguien que ya existe.
        </p>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <label className="flex flex-col gap-1 text-xs text-text/70">
            ID de usuario
            <input type="text" name="user_id" required className={INPUT_CLASS} autoFocus />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text/70">
            Nombre
            <input
              type="text"
              name="user_name"
              required
              className={INPUT_CLASS}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          {willTruncate && (
            <p className="text-xs text-text/50 m-0">
              El dispositivo trunca los nombres a 8 caracteres: se guardará como{" "}
              <span className="font-mono text-text">&quot;{truncated}&quot;</span>.
            </p>
          )}
          <label className="flex flex-col gap-1 text-xs text-text/70">
            Privilegio inicial
            <select name="user_privilege" className={INPUT_CLASS} defaultValue="USER">
              <option value="USER">USER</option>
              <option value="MANAGER">MANAGER</option>
            </select>
          </label>
          <Btn type="submit" variant="primary" disabled={isPending}>
            {isPending ? "Encolando…" : "Crear usuario"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
