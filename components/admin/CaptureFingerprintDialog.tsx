"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { OperationProgress, OperationResult } from "./OperationStatus";
import { useOperation } from "./useOperation";
import { captureFingerprintAction } from "@/app/admin/actions";

/**
 * Lee TODO lo que el equipo tiene registrado para este usuario con
 * GET_USER_INFO (la forma limpia de 612 bytes — nunca GET_ENROLL_DATA, ver
 * docs/05-commands-catalog.md) y lo guarda como copia canónica del empleado.
 * No pide elegir un número de dedo: el slot que usa el equipo es solo orden
 * de registro, no identidad de dedo (verificado contra hardware real — un
 * índice derecho quedó en el mismo slot 0 que antes se documentaba como
 * "pulgar derecho"). Una vez capturada, se empuja sola a cualquier otro
 * equipo donde esta persona ya tenga cuenta (fan-out de captura, ver
 * lib/enrollment.ts) — típicamente los que el alta al grupo ya creó vacíos.
 */
export function CaptureFingerprintDialog({
  employeeId,
  devId,
  deviceUserId,
  deviceLabel,
}: {
  employeeId: number;
  devId: string;
  deviceUserId: string;
  deviceLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const { formAction, startError, op, busy, reset } = useOperation(captureFingerprintAction);

  function close() {
    setOpen(false);
    reset();
  }

  return (
    <>
      <IconBtn icon={Icon.capture} label={`Capturar huella desde ${deviceLabel}`} onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={close} closable={!busy} title={`Capturar huella desde ${deviceLabel}`}>
        <div className="flex flex-col gap-3">
          {!op && (
            <>
              <p className="m-0 text-xs text-text/70">
                Lee todas las huellas que esta persona tiene registradas en este equipo y las
                guarda como referencia. Si ya tiene cuenta en otros equipos, se las copia sola —
                no hace falta repetirlo a mano.
              </p>
              <form action={formAction} className="flex flex-col gap-3">
                <input type="hidden" name="employee_id" value={employeeId} />
                <input type="hidden" name="dev_id" value={devId} />
                <input type="hidden" name="device_user_id" value={deviceUserId} />
                {startError && <p className="text-sm m-0 text-text">{startError}</p>}
                <Btn type="submit" variant="primary" disabled={busy}>
                  {busy ? "Consultando…" : "Capturar"}
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
