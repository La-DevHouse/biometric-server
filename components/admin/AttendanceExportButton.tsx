"use client";

import { useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { Icon } from "@/components/ui/icons";
import { Combobox } from "@/components/ui/Combobox";
import { useToast } from "./Toaster";
import { formatIoTime } from "@/lib/ioTime";
import { exportPreflightAction, type EmployeeOption } from "@/app/admin/empresas/[id]/asistencia/actions";
import type { UnmatchedDeviceUser } from "@/lib/companyAttendance";

/** Descarga sin salir de la página (el export es un GET con Content-Disposition). */
function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const key = (u: { dev_id: string; user_id: string }) => `${u.dev_id}\u0000${u.user_id}`;

/**
 * Exportar a Galepso (docs/11 R8/R10). Antes de descargar revisa si en el rango
 * hay marcaciones de IDs de equipo que no son de ningún empleado (IDs viejos que
 * no son la cédula). Si hay, avisa y deja excluirlas o asignar cada ID a una
 * persona SOLO para este archivo: la asignación viaja en el pedido (`asg`) y no
 * se guarda; el próximo export vuelve a preguntar.
 */
export function AttendanceExportButton({
  companyId,
  href,
  from,
  to,
  sede,
}: {
  companyId: number;
  href: string;
  from: string;
  to: string;
  sede: number | null;
}) {
  const { push } = useToast();
  const [busy, setBusy] = useState(false);
  const [unmatched, setUnmatched] = useState<UnmatchedDeviceUser[] | null>(null);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});

  async function start() {
    setBusy(true);
    try {
      const res = await exportPreflightAction(companyId, { from, to, sede });
      if (!res.ok) {
        push("error", res.error);
        return;
      }
      if (res.unmatched.length === 0) {
        download(href);
        return;
      }
      setEmployees(res.employees);
      setChoice({});
      setUnmatched(res.unmatched);
    } finally {
      setBusy(false);
    }
  }

  function finish(applyAssignments: boolean) {
    const list = unmatched ?? [];
    const assignments = applyAssignments
      ? list
          .filter((u) => choice[key(u)])
          .map((u) => ({ dev_id: u.dev_id, user_id: u.user_id, employee_id: Number(choice[key(u)]) }))
      : [];
    setUnmatched(null);
    download(assignments.length > 0 ? `${href}&asg=${encodeURIComponent(JSON.stringify(assignments))}` : href);
  }

  const list = unmatched ?? [];
  const assignedCount = list.filter((u) => choice[key(u)]).length;
  const totalMarks = list.reduce((n, u) => n + u.marks, 0);

  return (
    <>
      <Btn variant="icon" onClick={start} disabled={busy} aria-label="Exportar a Excel (Galepso)">
        {Icon.export}
      </Btn>
      <Dialog
        open={unmatched !== null}
        onClose={() => setUnmatched(null)}
        closable={!busy}
        title="Marcaciones sin empleado"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Btn onClick={() => finish(false)} disabled={busy}>
              Excluir todas y exportar
            </Btn>
            <Btn variant="primary" onClick={() => finish(true)} disabled={busy}>
              {assignedCount > 0 ? `Asignar ${assignedCount} y exportar` : "Exportar sin estas"}
            </Btn>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm">
            En este rango hay <strong>{totalMarks}</strong> marcaci{totalMarks === 1 ? "ón" : "ones"} de{" "}
            <strong>{list.length}</strong> ID{list.length === 1 ? "" : "s"} del equipo que no corresponde
            {list.length === 1 ? "" : "n"} a ningún empleado (su ID no es una cédula registrada). Así como están, no
            salen en el export.
          </p>
          <p className="m-0 text-xs text-text/70">
            Elegí a quién pertenece cada ID para incluir sus marcaciones en este archivo, o dejalo en «Excluir». La
            asignación es solo para esta descarga: no se guarda ni cambia nada en el sistema. Solo salen las que caen
            dentro del contrato de esa persona con la empresa.
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {list.map((u) => (
              <li key={key(u)} className="flex flex-col gap-2 border border-neutral-300 p-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-sm">
                    <span className="font-mono">{u.user_id}</span>
                    {u.user_name ? <span className="text-text/80"> · {u.user_name}</span> : null}
                  </span>
                  <span className="text-xs text-text/70">
                    {u.device_name} · {u.site_name} — {u.marks} marcaci{u.marks === 1 ? "ón" : "ones"} (
                    {formatIoTime(u.first_io_time)}
                    {u.first_io_time !== u.last_io_time ? ` → ${formatIoTime(u.last_io_time)}` : ""})
                  </span>
                </div>
                <div className="sm:w-64">
                  <Combobox
                    options={employees}
                    value={choice[key(u)] ?? ""}
                    onChange={(v) => setChoice((c) => ({ ...c, [key(u)]: v }))}
                    emptyLabel="Excluir"
                    placeholder="Buscar persona…"
                    ariaLabel={`Persona para el ID ${u.user_id}`}
                    disabled={busy}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
