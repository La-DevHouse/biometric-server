"use client";

import { useActionState, useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { useToast } from "./Toaster";
import { assignEnrollmentAction } from "@/app/admin/enrolamiento/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";

const INPUT = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

export interface EnrollCandidate {
  id: number;
  label: string;
}

export function AssignEnrollmentDialog({
  devId,
  deviceUserId,
  deviceUserName,
  candidates,
}: {
  devId: string;
  deviceUserId: string;
  deviceUserName: string | null;
  candidates: EnrollCandidate[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(assignEnrollmentAction, ADMIN_ACTION_INITIAL);
  const { push } = useToast();

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Vinculado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      <Btn variant="secondary" onClick={() => setOpen(true)}>
        Vincular empleado
      </Btn>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={`Vincular slot ${deviceUserId}${deviceUserName ? ` · ${deviceUserName}` : ""}`}
      >
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="dev_id" value={devId} />
          <input type="hidden" name="device_user_id" value={deviceUserId} />
          <p className="m-0 text-xs text-text/50">
            Los marcajes que lleguen con el ID <span className="font-mono">{deviceUserId}</span> de
            este equipo se atribuirán a la persona que elijas.
          </p>
          <label className="flex flex-col gap-1 text-xs text-text/70">
            Empleado *
            {candidates.length === 0 ? (
              <span className="text-text/50">
                No hay empleados con empleo activo para este equipo.
              </span>
            ) : (
              <select name="employee_id" required className={INPUT} autoFocus defaultValue="">
                <option value="" disabled>
                  — elegí una persona —
                </option>
                {candidates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            )}
          </label>
          <Btn type="submit" variant="primary" disabled={pending || candidates.length === 0}>
            {pending ? "Vinculando…" : "Vincular"}
          </Btn>
        </form>
      </Dialog>
    </>
  );
}
