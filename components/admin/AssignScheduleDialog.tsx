"use client";

import { useMemo, useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import { assignScheduleAction } from "@/app/admin/empresas/[id]/empleados/actions";

export interface SchedulePerson {
  employmentId: number;
  name: string;
  nationalId: string;
  scheduleId: number | null;
  scheduleName: string | null;
}

/**
 * Asignar un horario a varias personas de la empresa a la vez, vigente desde una
 * fecha (docs/16): los días anteriores conservan el horario que tenían. Sin
 * horario, el motor de asistencia solo cuenta horas: ni tardanzas ni ausencias.
 */
export function AssignScheduleDialog({
  companyId,
  people,
  schedules,
  today,
}: {
  companyId: number;
  people: SchedulePerson[];
  schedules: { id: number; name: string }[];
  /** Hoy en Caracas ("YYYY-MM-DD"): valor por defecto y tope de "Vigente desde". */
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [startsOn, setStartsOn] = useState(today);
  const [scheduleId, setScheduleId] = useState<string>(schedules[0] ? String(schedules[0].id) : "");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [pending, start] = useTransition();
  const { push } = useToast();
  const withoutSchedule = useMemo(
    () => people.filter((p) => p.scheduleId == null).map((p) => p.employmentId),
    [people]
  );

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function submit() {
    start(async () => {
      const r = await assignScheduleAction(companyId, scheduleId === "" ? null : Number(scheduleId), [...picked], startsOn);
      push(r.ok ? "ok" : "error", r.ok ? r.message : r.error);
      if (r.ok) {
        setPicked(new Set());
        setOpen(false);
      }
    });
  }

  const removing = scheduleId === "";

  return (
    <>
      <IconBtn icon={Icon.navSchedules} label="Asignar horario" onClick={() => setOpen(true)} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closable={!pending}
        title="Asignar horario"
        footer={
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </Btn>
            <Btn variant="primary" onClick={submit} disabled={pending || picked.size === 0 || schedules.length === 0 || !startsOn}>
              {pending ? "Guardando…" : `${removing ? "Quitar horario a" : "Asignar a"} ${picked.size} persona(s)`}
            </Btn>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          {schedules.length === 0 ? (
            <p className="m-0 text-sm">
              Esta empresa todavía no tiene horarios. Créelos en <strong>Horarios y turnos</strong> y vuelva aquí.
            </p>
          ) : (
            <label className={LABEL}>
              Horario
              <select
                className={INPUT}
                value={scheduleId}
                onChange={(e) => setScheduleId(e.target.value)}
                disabled={pending}
              >
                {schedules.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value="">— Quitar el horario —</option>
              </select>
            </label>
          )}
          {schedules.length > 0 && (
            <label className={LABEL}>
              Vigente desde
              <input
                type="date"
                className={INPUT}
                value={startsOn}
                max={today}
                onChange={(e) => setStartsOn(e.target.value)}
                disabled={pending}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-text/70">Seleccionar:</span>
            {[
              { label: "todos", ids: people.map((p) => p.employmentId), off: false },
              { label: `solo los sin horario (${withoutSchedule.length})`, ids: withoutSchedule, off: withoutSchedule.length === 0 },
              { label: "ninguno", ids: [] as number[], off: picked.size === 0 },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                onClick={() => setPicked(new Set(o.ids))}
                disabled={pending || o.off}
                className="cursor-pointer border-0 bg-transparent p-0 text-sm text-accent underline-offset-2 hover:underline disabled:cursor-default disabled:text-text/40 disabled:no-underline"
              >
                {o.label}
              </button>
            ))}
          </div>
          <ul className="m-0 flex max-h-[50vh] list-none flex-col gap-1 overflow-y-auto p-0">
            {people.map((p) => (
              <li key={p.employmentId}>
                <label className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={picked.has(p.employmentId)}
                    onChange={() => toggle(p.employmentId)}
                    disabled={pending}
                  />
                  <span className="flex-1">{p.name}</span>
                  <span className="font-mono text-xs text-text/60">{p.nationalId}</span>
                  <span className="w-40 truncate text-right text-xs text-text/70">{p.scheduleName ?? "sin horario"}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="m-0 text-xs text-text/70">
            Los días anteriores a esa fecha conservan el horario que tenían; si un contrato empezó después, cuenta desde su
            inicio. Al guardar se recalcula la asistencia desde esa fecha.
          </p>
        </div>
      </Dialog>
    </>
  );
}
