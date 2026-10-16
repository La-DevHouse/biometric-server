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

  function finish() {
    const list = unmatched ?? [];
    const assignments = list
      .filter((u) => choice[key(u)])
      .map((u) => ({ dev_id: u.dev_id, user_id: u.user_id, employee_id: Number(choice[key(u)]) }));
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
        title="Hay marcaciones sin empleado"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Btn onClick={() => setUnmatched(null)} disabled={busy}>
              Cancelar
            </Btn>
            <Btn variant="primary" onClick={finish} disabled={busy}>
              {assignedCount > 0 ? `Exportar e incluir ${assignedCount} ID${assignedCount === 1 ? "" : "s"}` : "Exportar sin incluirlas"}
            </Btn>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm">
            En este rango hay <strong>{totalMarks}</strong> marcaci{totalMarks === 1 ? "ón" : "ones"} de{" "}
            {list.length === 1 ? "un ID" : <><strong>{list.length}</strong> IDs</>} que no{" "}
            {list.length === 1 ? "es la cédula" : "son la cédula"} de ningún empleado registrado.{" "}
            <strong>Si no hacés nada, no se incluyen en el archivo.</strong>
          </p>
          <p className="m-0 text-xs text-text/70">
            Si sabés de quién son, elegí a la persona y se incluyen a su nombre — solo en este archivo, no se guarda
            nada. Si el ID es una cédula, es probablemente una persona que todavía no está registrada en el sistema.
          </p>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {list.map((u) => (
              <li key={key(u)} className="flex flex-col gap-3 border border-neutral-300 p-3 sm:flex-row sm:items-end">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text/60">ID en el equipo</span>
                  <span className="font-mono text-lg font-semibold leading-none">{u.user_id}</span>
                  <span className="text-sm">
                    {u.user_name ? (
                      <>Nombre en el equipo: {u.user_name}</>
                    ) : (
                      <span className="text-text/60">Sin nombre en el equipo</span>
                    )}
                  </span>
                  <span className="text-xs text-text/70">
                    {u.marks} marcaci{u.marks === 1 ? "ón" : "ones"} ·{" "}
                    {u.first_io_time === u.last_io_time
                      ? formatIoTime(u.first_io_time)
                      : `${formatIoTime(u.first_io_time)} → ${formatIoTime(u.last_io_time)}`}{" "}
                    · {u.device_name}, {u.site_name}
                  </span>
                </div>
                <label className="flex flex-col gap-1 sm:w-64">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-text/60">¿De quién son?</span>
                  <Combobox
                    options={employees}
                    value={choice[key(u)] ?? ""}
                    onChange={(v) => setChoice((c) => ({ ...c, [key(u)]: v }))}
                    emptyLabel="No incluir"
                    placeholder="Buscar persona…"
                    ariaLabel={`¿De quién son las marcaciones del ID ${u.user_id}?`}
                    disabled={busy}
                  />
                </label>
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
