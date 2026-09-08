"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { pushFingerprintAction } from "@/app/admin/actions";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export interface PushTarget {
  devId: string;
  label: string;
}

/**
 * Escribe la copia canónica de una huella en otro equipo vía SET_ENROLL_DATA
 * (agrega la huella a un usuario ya vinculado, sin tocar el resto de su
 * ficha — verificado contra hardware real). Requiere que la persona ya tenga
 * un enrolamiento activo en el equipo destino; si no, avisa que hay que
 * vincularla primero desde Enrolamiento en vez de intentar crearla sola acá.
 */
export function PushFingerprintDialog({
  employeeId,
  fingerIndex,
  targets,
}: {
  employeeId: number;
  fingerIndex: number;
  targets: PushTarget[];
}) {
  const [open, setOpen] = useState(false);
  const { formAction, startError, op, busy, reset } = useOperation(pushFingerprintAction);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <Btn variant="ghost" onClick={() => setOpen(true)}>
        Copiar a otro equipo
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title={`Copiar huella (dedo ${fingerIndex}) a otro equipo`}>
        <div className="flex flex-col gap-3">
          {!op && (
            <>
              <p className="m-0 text-xs text-text/70">
                Escribe esta huella en un equipo donde la persona ya tenga un usuario vinculado. La
                confirmación real es física: pedile que marque asistencia con ese dedo ahí.
              </p>
              <form action={formAction} className="flex flex-col gap-3">
                <input type="hidden" name="employee_id" value={employeeId} />
                <input type="hidden" name="finger_index" value={fingerIndex} />
                <label className="flex flex-col gap-1 text-xs text-text/85">
                  Equipo destino *
                  {targets.length === 0 ? (
                    <span className="text-text/70">
                      La persona no tiene otro equipo vinculado activo. Vinculala primero desde
                      Enrolamiento.
                    </span>
                  ) : (
                    <select name="target_dev_id" required className={INPUT} defaultValue="" autoFocus>
                      <option value="" disabled>
                        — elegí un equipo —
                      </option>
                      {targets.map((t) => (
                        <option key={t.devId} value={t.devId}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                {startError && <p className="text-sm m-0 text-text">{startError}</p>}
                <Btn type="submit" variant="primary" disabled={busy || targets.length === 0}>
                  {busy ? "Copiando…" : "Copiar"}
                </Btn>
              </form>
            </>
          )}
          {op && !op.isTerminal && <OperationProgress op={op} />}
          {op?.isTerminal && <OperationResult op={op} onClose={close} />}
        </div>
      </Dialog>
    </>
  );
}
