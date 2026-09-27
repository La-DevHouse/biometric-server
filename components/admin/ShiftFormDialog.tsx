"use client";

import { useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { useToast } from "./Toaster";
import { useFormSubmit } from "@/components/ui/useFormSubmit";
import { createShiftAction, updateShiftAction } from "@/app/admin/horarios/actions";
import { ADMIN_ACTION_INITIAL } from "@/lib/adminActionState";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL, FIELD_OPTIONAL, FIELD_HINT } from "@/components/ui/fieldStyles";
import { Tag } from "@/components/ui/Tag";
import { cx } from "@/lib/cx";
import { computeShiftTimes, formatMinutes, maskTime, normalizeTime } from "@/lib/shiftTime";

type TimeField = "start" | "end" | "breakStart" | "breakEnd";
type Times = Record<TimeField, string>;

function timesOf(shift?: ShiftValues): Times {
  return {
    start: shift?.start_time ?? "",
    end: shift?.end_time ?? "",
    breakStart: shift?.break_start ?? "",
    breakEnd: shift?.break_end ?? "",
  };
}

const DAYS = [
  [1, "Lun"],
  [2, "Mar"],
  [3, "Mié"],
  [4, "Jue"],
  [5, "Vie"],
  [6, "Sáb"],
  [7, "Dom"],
] as const;

export interface ShiftValues {
  id: number;
  code: string | null;
  name: string;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  hours: string | null;
  variable_in_out: boolean;
  crosses_midnight: boolean;
  workdays: number[];
  effective_from: string; // YYYY-MM-DD
  effective_to: string | null;
}

export function ShiftFormDialog({
  scheduleGroupId,
  shift,
}: {
  scheduleGroupId: number;
  shift?: ShiftValues;
}) {
  const editing = !!shift;
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    editing ? updateShiftAction : createShiftAction,
    ADMIN_ACTION_INITIAL
  );
  const onSubmit = useFormSubmit(formAction, state);
  const { push } = useToast();
  const formId = useId();
  // Horas controladas: de ellas salen en vivo las horas de jornada y si cruza
  // la medianoche (lib/shiftTime — el servidor lo recalcula igual al guardar).
  const [times, setTimes] = useState<Times>(() => timesOf(shift));
  const [touched, setTouched] = useState<Partial<Record<TimeField, boolean>>>({});
  const calc = computeShiftTimes(times);
  // El error se muestra recién cuando el campo se tocó (o al intentar guardar).
  const fieldError = (f: TimeField) => (!calc.ok && calc.field === f && touched[f] ? calc.error : null);

  function openDialog() {
    setTimes(timesOf(shift));
    setTouched({});
    setOpen(true);
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    if (!calc.ok) {
      e.preventDefault();
      setTouched({ start: true, end: true, breakStart: true, breakEnd: true });
      return;
    }
    // Enter sin salir del campo: normalizar igual lo que viaja ("7:00" → "07:00").
    for (const el of e.currentTarget.querySelectorAll<HTMLInputElement>("input[data-time]")) {
      el.value = normalizeTime(el.value);
    }
    onSubmit(e);
  }

  function timeInput(f: TimeField, name: string, placeholder: string, required = false) {
    const err = fieldError(f);
    return (
      <>
        <input
          name={name}
          required={required}
          data-time
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          value={times[f]}
          onChange={(e) => setTimes((t) => ({ ...t, [f]: maskTime(e.target.value) }))}
          onBlur={(e) => {
            setTimes((t) => ({ ...t, [f]: normalizeTime(e.target.value) }));
            setTouched((t) => ({ ...t, [f]: true }));
          }}
          aria-invalid={err ? true : undefined}
          className={cx(INPUT, "font-mono", err && "border-danger-600 focus:border-danger-600 focus:ring-danger-100")}
          placeholder={placeholder}
        />
        {err && <span className={cx(FIELD_HINT, "text-danger-700")}>{err}</span>}
      </>
    );
  }

  useEffect(() => {
    if (state.status === "ok") {
      push("ok", state.message ?? "Guardado.");
      setOpen(false);
    } else if (state.status === "error") push("error", state.error);
  }, [state, push]);

  return (
    <>
      {editing ? (
        <IconBtn icon={Icon.edit} label="Editar turno" onClick={openDialog} />
      ) : (
        <IconBtn icon={Icon.add} label="Nuevo turno" onClick={openDialog} />
      )}
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar turno" : "Nuevo turno"}
        footer={
          <Btn type="submit" form={formId} variant="primary" disabled={pending}>
            {pending ? "Guardando…" : editing ? "Guardar" : "Crear turno"}
          </Btn>
        }
      >
        <form id={formId} onSubmit={submit} className="flex flex-col gap-3" noValidate>
          {editing ? (
            <input type="hidden" name="id" value={shift.id} />
          ) : (
            <input type="hidden" name="schedule_group_id" value={scheduleGroupId} />
          )}

          <div className="flex flex-col sm:grid sm:grid-cols-2 gap-2">
            <label className={LABEL}>
              Nombre *
              <input name="name" required defaultValue={shift?.name ?? ""} className={INPUT} autoFocus />
            </label>
            <label className={LABEL}>
              <span>
                Código <span className={FIELD_OPTIONAL}>opcional</span>
              </span>
              <input name="code" defaultValue={shift?.code ?? ""} className={INPUT} placeholder="8/12-2/6" />
              <span className={FIELD_HINT}>Identificador corto de ALCO.</span>
            </label>
            <label className={LABEL}>
              Hora inicio *
              {timeInput("start", "start_time", "06:30", true)}
            </label>
            <label className={LABEL}>
              Hora fin *
              {timeInput("end", "end_time", "13:30", true)}
            </label>
            <label className={LABEL}>
              Inicio descanso
              {timeInput("breakStart", "break_start", "12:00")}
            </label>
            <label className={LABEL}>
              Fin descanso
              {timeInput("breakEnd", "break_end", "13:00")}
            </label>
            {/* Calculado, no editable: duración − descanso (lib/shiftTime). */}
            <div className={LABEL}>
              Horas de jornada
              <div className="flex h-(--control-h) items-center gap-[8px] border border-neutral-300 bg-chrome px-(--control-px) font-sans text-sm normal-case tracking-normal text-text">
                {calc.ok ? (
                  <>
                    <span className="whitespace-nowrap font-mono">{formatMinutes(calc.workedMinutes)}</span>
                    {calc.crossesMidnight && <Tag variant="accent2">Cruza medianoche</Tag>}
                  </>
                ) : (
                  <span className="text-neutral-600">se calcula con las horas</span>
                )}
              </div>
              <span className={FIELD_HINT}>
                {calc.ok && calc.crossesMidnight
                  ? "Termina al día siguiente (la hora de fin es menor que la de inicio)."
                  : "Duración del turno menos el descanso."}
              </span>
            </div>
            <label className={LABEL}>
              Vigencia desde *
              <input name="effective_from" type="date" required defaultValue={shift?.effective_from ?? ""} className={INPUT} />
            </label>
            <label className={LABEL}>
              Vigencia hasta
              <input name="effective_to" type="date" defaultValue={shift?.effective_to ?? ""} className={INPUT} />
            </label>
          </div>

          <div className={LABEL}>
            Días de trabajo
            {/* Una sola línea: casillas y texto más chicos que el estándar, solo acá. */}
            <div className="flex flex-nowrap justify-between gap-[6px] font-sans text-xs normal-case tracking-normal text-text">
              {DAYS.map(([n, lbl]) => (
                <label key={n} className="flex cursor-pointer items-center gap-[4px]">
                  <input
                    className="h-[15px]! w-[15px]!"
                    type="checkbox"
                    name="workdays"
                    value={n}
                    defaultChecked={shift ? shift.workdays.includes(n) : n >= 1 && n <= 5}
                  />
                  {lbl}
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-[10px] text-sm text-text">
            <input type="checkbox" name="variable_in_out" defaultChecked={shift?.variable_in_out ?? false} />
            Entrada y salida variable
          </label>
        </form>
      </Dialog>
    </>
  );
}
