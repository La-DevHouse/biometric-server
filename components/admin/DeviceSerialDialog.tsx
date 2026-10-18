"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useOperation } from "./useOperation";
import { setDeviceSerialAction } from "@/app/admin/actions";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_HINT } from "@/components/ui/fieldStyles";

/**
 * "Corregir serial" de un facial (docs/04 → "dev_id placeholder"): se identifica
 * por su nombre interno, y algunos llegan con uno de fábrica (ej. FK_DEV). Se le
 * escribe el serial de la caja; cuando lo acepta, el equipo pasa a llamarse así
 * en el sistema con todo lo suyo.
 */
export function DeviceSerialDialog({
  devId,
  suspectShared,
}: {
  devId: string;
  /** Llegan consultas como de más de un equipo con este mismo nombre. */
  suspectShared: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [serial, setSerial] = useState("");
  const { onSubmit, startError, busy } = useOperation(setDeviceSerialAction, { onStarted: () => setOpen(false) });

  return (
    <>
      <IconBtn icon={Icon.key} label="Corregir serial" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={() => setOpen(false)} closable={!busy} title="Corregir serial">
        <form onSubmit={onSubmit} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <p className="m-0 text-sm">
            Este equipo facial se identifica por su nombre interno, que hoy es{" "}
            <span className="font-mono font-semibold">{devId}</span>. Si no es el serial, escribí el que figura en la
            caja (o en el menú del equipo → Info del sistema).
          </p>
          {suspectShared && (
            <p className="m-0 border border-neutral-500 p-2 text-sm">
              <strong>Ojo:</strong> parece que hay <strong>más de un equipo</strong> conectándose con el nombre{" "}
              <span className="font-mono">{devId}</span>. El serial le llega al primero que consulte, que puede no
              ser el de esta caja. Dejá conectado solo uno, o corregilo desde el menú del propio equipo.
            </p>
          )}
          <label className={LABEL}>
            Serial de la caja
            <input
              name="serial"
              className={`${INPUT} font-mono`}
              value={serial}
              onChange={(e) => setSerial(e.target.value.trim())}
              required
              pattern="[A-Za-z0-9\-]{4,24}"
              placeholder="2401058627"
              autoFocus
              autoComplete="off"
            />
            <span className={FIELD_HINT}>
              Se le escribe al equipo como su nombre interno. Cuando lo acepte (unos segundos si está en línea), pasa a
              aparecer con este serial, con sus usuarios, marcaciones y asignación de sede.
            </span>
          </label>
          {startError && <p className="m-0 text-sm text-text">{startError}</p>}
          <Btn type="submit" variant="primary" disabled={busy || serial.length < 4}>
            {busy ? "Enviando…" : "Enviar serial al equipo"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
