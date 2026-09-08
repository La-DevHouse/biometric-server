"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { createUserAction } from "@/app/admin/actions";
// Directo de kinds.ts, no del barrel @/lib/operations — ese barrel arrastra
// lib/db.ts (`pg`) al bundle del navegador si se importa como valor desde un
// componente cliente (verificado en vivo: "Module not found: Can't resolve 'dns'").
import { PRIVILEGE_SCREEN_LABEL } from "@/lib/operations/kinds";

const INPUT_CLASS = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export function CreateUserDialog({ devId }: { devId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { formAction, startError, startWarning, op, busy, reset } = useOperation(createUserAction);

  function close() {
    setOpen(false);
    setName("");
    reset();
  }

  const truncated = name.trim().slice(0, 8);
  const willTruncate = name.trim().length > 8;

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + Crear usuario nuevo
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title="Crear usuario nuevo">
        <div className="flex flex-col gap-3">
          {!op && (
            <>
              <p className="text-xs text-text/70 m-0">
                Solo para gente que todavía no existe en el equipo — registra su ID, nombre y
                privilegio. La huella se agrega después, físicamente en el dispositivo; si el ID ya
                existe, esto se niega a tocarlo (no sobreescribe ni &quot;resetea&quot; a nadie).
              </p>
              <p className="text-xs text-text/70 m-0">
                Puede tardar hasta 30 segundos: antes de crear, se confirma con el equipo que el ID
                esté realmente libre, y esa comprobación es lenta por diseño — es lo que evita
                arruinar las huellas de alguien que ya existe.
              </p>
              <form action={formAction} className="flex flex-col gap-3">
                <input type="hidden" name="dev_id" value={devId} />
                <label className="flex flex-col gap-1 text-xs text-text/85">
                  ID de usuario
                  <input type="text" name="user_id" required className={INPUT_CLASS} autoFocus />
                </label>
                <label className="flex flex-col gap-1 text-xs text-text/85">
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
                  <p className="text-xs text-text/70 m-0">
                    El dispositivo trunca los nombres a 8 caracteres: se guardará como{" "}
                    <span className="font-mono text-text">&quot;{truncated}&quot;</span>.
                  </p>
                )}
                <label className="flex flex-col gap-1 text-xs text-text/85">
                  Privilegio inicial
                  <select name="user_privilege" className={INPUT_CLASS} defaultValue="USER">
                    <option value="USER">{PRIVILEGE_SCREEN_LABEL.USER}</option>
                    <option value="MANAGER">{PRIVILEGE_SCREEN_LABEL.MANAGER}</option>
                  </select>
                </label>
                {startError && <p className="text-sm m-0 text-text">{startError}</p>}
                <Btn type="submit" variant="primary" disabled={busy}>
                  {busy ? "Enviando…" : "Crear usuario"}
                </Btn>
              </form>
            </>
          )}
          {op && !op.isTerminal && (
            <div className="flex flex-col gap-2">
              {startWarning && <p className="text-xs text-text/70 m-0">{startWarning}</p>}
              <OperationProgress op={op} />
            </div>
          )}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
