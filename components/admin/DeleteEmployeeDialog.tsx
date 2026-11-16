"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { FIELD_INPUT as INPUT } from "@/components/ui/fieldStyles";
import { useToast } from "./Toaster";
import { deleteEmployeeAction } from "@/app/admin/empleados/actions";
import type { EmployeeDeletionInfo } from "@/lib/employeeDeletion";

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Eliminar a una persona (solo administradores, lib/employeeDeletion): con un contrato
 * abierto solo explica por qué no se puede; si no, dice qué se borra y qué se conserva
 * y pide escribir el documento para confirmar.
 */
export function DeleteEmployeeDialog({
  employeeId,
  name,
  nationalId,
  info,
}: {
  employeeId: number;
  name: string;
  nationalId: string;
  info: EmployeeDeletionInfo;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const { push } = useToast();
  const router = useRouter();
  const blocked = info.openWith.length > 0;

  function close() {
    setOpen(false);
    setTyped("");
  }

  function run() {
    start(async () => {
      const r = await deleteEmployeeAction(employeeId);
      if (r.ok) {
        push("ok", r.message);
        close();
        router.push("/admin/empleados");
      } else push("error", r.error);
    });
  }

  return (
    <>
      <IconBtn icon={Icon.trash} label="Eliminar empleado…" tone="danger" onClick={() => setOpen(true)} />
      <Dialog open={open} onClose={close} closable={!pending} title={`Eliminar a ${name}`}>
        {blocked ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0">
              <strong>No se puede eliminar:</strong> tiene contrato vigente con {info.openWith.join(", ")}.
            </p>
            <p className="m-0 text-text/75">
              Primero dele de baja en Contratos de trabajo. Solo se puede eliminar a una persona sin contrato vigente ni
              por empezar con ninguna empresa.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <p className="m-0">Se borra definitivamente, sin forma de deshacerlo:</p>
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
              <li>La persona y sus datos, incluida la foto de la cédula.</li>
              {info.closedContracts > 0 && (
                <li>
                  {n(info.closedContracts, "contrato cerrado", "contratos cerrados")}, con{" "}
                  {n(info.attendanceDays, "día de asistencia", "días de asistencia")} y{" "}
                  {n(info.corrections, "corrección manual", "correcciones manuales")}. Dejará de salir en los reportes
                  y exportaciones de esos períodos.
                </li>
              )}
              {info.fingerprints > 0 && <li>{n(info.fingerprints, "huella guardada", "huellas guardadas")} en el servidor.</li>}
            </ul>
            <p className="m-0 text-text/75">
              {info.marks > 0
                ? `Se conservan ${n(info.marks, "marcación", "marcaciones")} en los equipos (quedan como un ID sin empleado) y el registro de auditoría, con una copia de sus datos.`
                : "Se conserva el registro de auditoría, con una copia de sus datos."}
            </p>
            {info.devices.length > 0 && (
              <p className="m-0 border border-accent2 p-2 text-xs">
                Sigue registrada en {n(info.devices.length, "equipo", "equipos")}: {info.devices.join(", ")}. Eliminarla
                no la quita de ahí. Use “Sincronizar ahora” antes, o quedará en esos equipos como un ID sin empleado.
              </p>
            )}
            <label className="flex flex-col gap-1 text-xs text-text/85">
              Escriba el documento para confirmar: <span className="font-mono">{nationalId}</span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                aria-label="Documento de la persona"
                className={`${INPUT} font-mono`}
                autoComplete="off"
              />
            </label>
            <Btn variant="primary" disabled={pending || typed.trim().toUpperCase() !== nationalId.toUpperCase()} onClick={run}>
              {pending ? "Eliminando…" : "Eliminar definitivamente"}
            </Btn>
          </div>
        )}
      </Dialog>
    </>
  );
}
