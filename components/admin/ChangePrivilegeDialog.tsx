"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { changePrivilegeAction } from "@/app/admin/actions";
// Importar directo de kinds.ts (no del barrel @/lib/operations): ese barrel
// re-exporta lib/db.ts, que trae `pg` — un componente cliente que lo importe
// como valor (no solo como type) arrastra `pg` al bundle del navegador y
// rompe con "Module not found: Can't resolve 'dns'" (verificado en vivo).
import { PRIVILEGE_SCREEN_LABEL, type Privilege } from "@/lib/operations/kinds";

// El equipo tiene un tercer nivel en su propia pantalla ("Super Usuario",
// protocolo "OPERATOR") pero este comando no puede asignarlo de forma
// remota — verificado contra hardware real (2026-09-08): devuelve OK pero
// el equipo queda en "Usuario" de todas formas. No se ofrece como opción
// porque ya sabemos que no hace nada (ver docs/05-commands-catalog.md →
// SET_USER_PRIVILEGE).
const OPTIONS: { value: Privilege; label: string }[] = [
  { value: "USER", label: PRIVILEGE_SCREEN_LABEL.USER },
  { value: "MANAGER", label: PRIVILEGE_SCREEN_LABEL.MANAGER },
];

export function ChangePrivilegeDialog({
  devId,
  userId,
  currentPrivilege,
}: {
  devId: string;
  userId: string;
  currentPrivilege: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [privilege, setPrivilege] = useState<Privilege>((currentPrivilege as Privilege) || "USER");
  const { formAction, startError, op, busy, reset } = useOperation(changePrivilegeAction);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Privilegio
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title={`Privilegio de usuario ${userId}`}>
        <div className="flex flex-col gap-3">
          {!op && (
            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="dev_id" value={devId} />
              <input type="hidden" name="user_id" value={userId} />
              <input type="hidden" name="user_privilege" value={privilege} />
              <div className="flex flex-col gap-1.5">
                {OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="user_privilege_radio"
                      checked={privilege === opt.value}
                      onChange={() => setPrivilege(opt.value)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              {currentPrivilege && !OPTIONS.some((o) => o.value === currentPrivilege) && (
                <p className="text-xs text-text/70 m-0">
                  El equipo reporta un privilegio actual (
                  {PRIVILEGE_SCREEN_LABEL[currentPrivilege] ?? currentPrivilege}) que no está en esta
                  lista — se asignó físicamente en el equipo, y no hay forma de asignarlo de nuevo de
                  forma remota (verificado). Cambiarlo acá lo va a reemplazar por uno de estos dos; si
                  necesitás mantenerlo, hacelo desde el equipo directamente.
                </p>
              )}
              {startError && <p className="text-sm m-0 text-text">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy}>
                {busy ? "Enviando…" : "Cambiar y verificar"}
              </Btn>
            </form>
          )}
          {op && !op.isTerminal && <OperationProgress op={op} />}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
