"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useMultiOperation } from "./useOperation";
import { addEmployeeToDeviceAction } from "@/app/admin/actions";
// Directo de kinds.ts, no del barrel @/lib/operations — ver ChangePrivilegeDialog.tsx.
import { PRIVILEGE_SCREEN_LABEL } from "@/lib/operations/kinds";
import { FIELD_INPUT as INPUT } from "@/components/ui/fieldStyles";

export interface DeviceCandidateOption {
  devId: string;
  label: string;
}

/**
 * Alta manual en uno o varios equipos a la vez — para el caso excepcional
 * que el fan-out automático al grupo no cubre (Reunión 3, docs/09 D3: al
 * activar un contrato ya se enrola sola en todos los equipos del grupo con
 * "empleados compartidos"; esto es para un equipo de OTRA empresa/grupo).
 * Por eso `candidates` incluye equipos de cualquier empresa, no solo la
 * propia. Dispara una operación ADD_EMPLOYEE_TO_DEVICE por equipo elegido;
 * el ID de usuario es la cédula del empleado, y si ya tiene huellas
 * capturadas se copian de una vez.
 */
export function AddEmployeeToDeviceDialog({
  employeeId,
  candidates,
}: {
  employeeId: number;
  candidates: DeviceCandidateOption[];
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const { formAction, startError, startWarning, ops, busy, reset } = useMultiOperation(addEmployeeToDeviceAction);

  function close() {
    setOpen(false);
    setName("");
    reset();
  }

  const allTerminal = ops.length > 0 && ops.every((o) => o.isTerminal);

  return (
    <>
      <Btn variant="primary" onClick={() => setOpen(true)}>
        + Agregar a equipo
      </Btn>
      <Dialog open={open} onClose={close} closable={!busy} title="Agregar empleado a equipo(s)">
        <div className="flex flex-col gap-3">
          <p className="m-0 text-xs text-text/70">
            Los equipos del grupo de esta persona ya se enrolan solos al darle un contrato — usá
            esto solo para un equipo de otra empresa. Se muestran todos los equipos donde todavía
            no está vinculada, de cualquier empresa. Elegí uno o varios — nunca se agrega solo a
            todos.
          </p>
          {ops.length === 0 && (
            <form action={formAction} className="flex flex-col gap-3">
              <input type="hidden" name="employee_id" value={employeeId} />
              <label className="flex flex-col gap-1 text-xs text-text/85">
                Nombre en el equipo
                <input
                  type="text"
                  name="user_name"
                  required
                  className={INPUT}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-text/85">
                Privilegio inicial
                <select name="privilege" className={INPUT} defaultValue="USER">
                  <option value="USER">{PRIVILEGE_SCREEN_LABEL.USER}</option>
                  <option value="MANAGER">{PRIVILEGE_SCREEN_LABEL.MANAGER}</option>
                </select>
              </label>
              <fieldset className="flex flex-col gap-1 text-xs text-text/85 border-0 p-0 m-0">
                <legend className="p-0 mb-1">Equipos *</legend>
                {candidates.length === 0 ? (
                  <span className="text-text/70">
                    No hay equipos disponibles — ya está vinculada en todos los equipos registrados.
                  </span>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-[8rem] overflow-y-auto">
                    {candidates.map((c) => (
                      <label key={c.devId} className="flex items-center gap-2">
                        <input type="checkbox" name="dev_id" value={c.devId} />
                        {c.label}
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>
              {startError && <p className="text-sm m-0 text-text">{startError}</p>}
              <Btn type="submit" variant="primary" disabled={busy || candidates.length === 0}>
                {busy ? "Enviando…" : "Agregar"}
              </Btn>
            </form>
          )}
          {ops.length > 0 && (
            <div className="flex flex-col gap-3">
              {startWarning && <p className="text-xs text-text/70 m-0">{startWarning}</p>}
              <ul className="flex flex-col gap-1.5 list-none p-0 m-0">
                {ops.map((op) => (
                  <li key={op.id} className="text-sm flex items-start gap-1.5">
                    {!op.isTerminal && (
                      <span
                        className="w-2 h-2 mt-1 rounded-full bg-accent animate-op-pulse flex-none"
                        aria-hidden
                      />
                    )}
                    <span>
                      <span className="text-text/85">{op.dev_id}: </span>
                      {op.isTerminal
                        ? op.stage === "done"
                          ? op.note
                          : `${op.stageLabel}${op.note ? " — " + op.note : ""}`
                        : `${op.stageLabel}…`}
                    </span>
                  </li>
                ))}
              </ul>
              {allTerminal && (
                <Btn variant="primary" onClick={close}>
                  Cerrar
                </Btn>
              )}
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
