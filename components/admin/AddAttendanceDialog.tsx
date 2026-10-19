"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { FIELD_HINT, FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import { addAttendanceAction } from "@/app/admin/empleados/[id]/asistencia/actions";

export interface AttendancePerson {
  employmentId: number;
  /** Nombre (en la empresa) o empresa (en la ficha del empleado). */
  label: string;
  companyId: number;
}

/**
 * "Agregar asistencia" (docs/16): un día en que la persona no marcó nada — se le
 * cargan entrada y salida a mano, con motivo. Quedan como marcaciones agregadas
 * (correcciones): cuentan en Por día, el export y los reportes, y se pueden deshacer
 * desde "Corregir marcaciones" de ese día.
 */
export function AddAttendanceDialog({
  people,
  sitesByCompany,
  defaultDate,
  maxDate,
  personLabel = "Persona",
}: {
  people: AttendancePerson[];
  sitesByCompany: Record<number, { id: number; name: string }[]>;
  defaultDate: string;
  /** Hoy (Caracas): no se cargan días futuros. */
  maxDate: string;
  personLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [employmentId, setEmploymentId] = useState<string>(people.length === 1 ? String(people[0].employmentId) : "");
  const [ymd, setYmd] = useState(defaultDate);
  const [entry, setEntry] = useState("");
  const [exit, setExit] = useState("");
  const [exitNextDay, setExitNextDay] = useState(false);
  const [siteId, setSiteId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const { push } = useToast();

  const person = people.find((p) => String(p.employmentId) === employmentId);
  const sites = person ? (sitesByCompany[person.companyId] ?? []) : [];
  const site = siteId !== "" && sites.some((s) => String(s.id) === siteId) ? siteId : sites[0] ? String(sites[0].id) : "";

  function submit() {
    if (!person) return push("error", `Elija ${personLabel === "Persona" ? "la persona" : "el contrato"}.`);
    if (!entry) return push("error", "Indique la hora de entrada.");
    if (reason.trim().length < 5) return push("error", "Escriba el motivo (al menos 5 caracteres).");
    start(async () => {
      const r = await addAttendanceAction({
        employmentId: person.employmentId,
        ymd,
        entry,
        exit: exit || null,
        exitNextDay,
        siteId: Number(site),
        reason,
      });
      if (r.ok) {
        push("ok", exit ? "Asistencia agregada (entrada y salida)." : "Entrada agregada.");
        setOpen(false);
        setEntry("");
        setExit("");
        setExitNextDay(false);
        setReason("");
      } else push("error", r.error);
    });
  }

  return (
    <>
      <IconBtn icon={Icon.add} label="Agregar asistencia" onClick={() => setOpen(true)} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closable={!pending}
        title="Agregar asistencia"
        footer={
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Btn>
            <Btn variant="primary" onClick={submit} disabled={pending || people.length === 0}>
              {pending ? "Guardando…" : "Agregar"}
            </Btn>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0 text-sm">
            Para un día en que la persona no marcó en el equipo. Queda como marcación agregada a mano, con su motivo,
            quién y cuándo; se puede deshacer desde «Corregir marcaciones» de ese día.
          </p>
          {people.length === 0 ? (
            <p className="m-0 text-sm text-text/70">No hay contratos vigentes.</p>
          ) : (
            <label className={LABEL}>
              {personLabel} *
              <select className={INPUT} value={employmentId} onChange={(e) => setEmploymentId(e.target.value)} disabled={pending}>
                <option value="" disabled>
                  Elija…
                </option>
                {people.map((p) => (
                  <option key={p.employmentId} value={p.employmentId}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={LABEL}>
            Fecha *
            <input type="date" className={INPUT} value={ymd} max={maxDate} onChange={(e) => setYmd(e.target.value)} disabled={pending} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={LABEL}>
              Entrada *
              <input type="time" className={INPUT} value={entry} onChange={(e) => setEntry(e.target.value)} disabled={pending} />
            </label>
            <label className={LABEL}>
              Salida
              <input type="time" className={INPUT} value={exit} onChange={(e) => setExit(e.target.value)} disabled={pending} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={exitNextDay} onChange={(e) => setExitNextDay(e.target.checked)} disabled={pending || !exit} />
            La salida es del día siguiente (turno nocturno)
          </label>
          {sites.length > 1 && (
            <label className={LABEL}>
              Sede
              <select className={INPUT} value={site} onChange={(e) => setSiteId(e.target.value)} disabled={pending}>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className={LABEL}>
            Motivo *
            <textarea
              className={`${INPUT} h-auto min-h-16 py-2`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: olvidó marcar entrada y salida; lo confirmó el supervisor"
              disabled={pending}
            />
            <span className={FIELD_HINT}>Queda en la auditoría y en el reporte de incidencias.</span>
          </label>
        </div>
      </Dialog>
    </>
  );
}
