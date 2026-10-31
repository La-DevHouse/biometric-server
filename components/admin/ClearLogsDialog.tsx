"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useOperation } from "./useOperation";
import { clearLogsAction } from "@/app/admin/actions";

/**
 * "Liberar memoria de marcaciones" (lib/operations/clearLogs): respalda todas las
 * marcaciones del equipo en el servidor, verifica que quedaron guardadas y recién
 * ahí las borra del equipo. No toca usuarios ni huellas, y el servidor nunca borra
 * nada. Solo administradores.
 */
export function ClearLogsDialog({ devId, logCount }: { devId: string; logCount?: number | null }) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  // Segunda confirmación (docs/10 §6): escribir el número de serie del equipo.
  const [typed, setTyped] = useState("");
  const confirmed = ack && typed.trim() === devId;
  const clear = useOperation(clearLogsAction, { onStarted: close });

  function close() {
    setOpen(false);
    setAck(false);
    setTyped("");
  }

  return (
    <>
      <IconBtn icon={Icon.trash} label="Liberar memoria de marcaciones…" tone="danger" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={close} closable={!clear.busy} title="Liberar memoria de marcaciones">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm">
            Borra <strong>solo las marcaciones</strong> de la memoria del equipo
            {logCount != null ? ` (según la última lectura, ${logCount})` : ""}, para liberar espacio.{" "}
            <strong>No toca usuarios ni huellas</strong>, y en el servidor no se borra nada: las marcaciones siguen en
            Asistencia, en los reportes y en el export.
          </p>
          <ol className="m-0 flex list-decimal flex-col gap-1 pl-5 text-sm">
            <li>Trae al servidor todas las marcaciones del equipo.</li>
            <li>Verifica que cada una quedó guardada. Si falta alguna, se detiene sin borrar nada.</li>
            <li>Recién ahí las borra del equipo.</li>
            <li>Comprueba que usuarios y huellas quedaron igual que antes.</li>
          </ol>
          <p className="m-0 text-xs text-text/70">
            El equipo tiene que estar en línea. El avance se ve en el panel «Procesando».
          </p>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            Entiendo que las marcaciones se borran del equipo (no del servidor)
          </label>
          <label className="flex flex-col gap-1 text-xs text-text/85">
            Escriba el número de serie del equipo para confirmar: <span className="font-mono">{devId}</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Número de serie del equipo"
              className="h-(--control-h) border border-neutral-500 bg-surface px-(--control-px) font-mono text-sm"
              autoComplete="off"
            />
          </label>
          <form action={clear.formAction}>
            <input type="hidden" name="dev_id" value={devId} />
            {clear.startError && <p className="m-0 mb-2 text-sm text-text">{clear.startError}</p>}
            <Btn type="submit" variant="primary" disabled={clear.busy || !confirmed}>
              {clear.busy ? "Enviando…" : "Liberar memoria de marcaciones"}
            </Btn>
          </form>
        </div>
      </Dialog>
    </>
  );
}
