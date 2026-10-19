"use client";

import { useState, useTransition } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { Icon } from "@/components/ui/icons";
import { Tag } from "@/components/ui/Tag";
import { useToast } from "./Toaster";
import { FIELD_INPUT as INPUT, FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";
import {
  addMarkAction,
  dayMarksAction,
  revokeCorrectionAction,
  voidMarkAction,
} from "@/app/admin/empleados/[id]/asistencia/actions";
import type { DayMarks } from "@/lib/attendance/corrections";

const fmtWhen = (d: Date) =>
  new Date(d).toLocaleString("es-VE", { timeZone: "America/Caracas", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Corregir las marcaciones de un día (docs/16 paso 4): agregar una que falta,
 * anular una del equipo, o deshacer una corrección. Siempre con motivo; queda
 * quién y cuándo. Lo del equipo nunca se borra.
 */
export function CorrectDayDialog({ employmentId, ymd, who }: { employmentId: number; ymd: string; who: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DayMarks | null>(null);
  const [reason, setReason] = useState("");
  const [time, setTime] = useState("");
  const [nextDay, setNextDay] = useState(false);
  const [siteId, setSiteId] = useState<string>("");
  const [pending, start] = useTransition();
  const { push } = useToast();
  const dateLabel = `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

  function load() {
    start(async () => {
      try {
        const d = await dayMarksAction(employmentId, ymd);
        setData(d);
        if (d && siteId === "") setSiteId(d.defaultSiteId != null ? String(d.defaultSiteId) : "");
      } catch {
        push("error", "No se pudieron cargar las marcaciones del día. Intente de nuevo.");
      }
    });
  }

  function openDialog() {
    setOpen(true);
    load();
  }

  function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>, okMessage: string, needsReason = true) {
    if (needsReason && reason.trim().length < 5) {
      push("error", "Escriba primero el motivo de la corrección (al menos 5 caracteres).");
      return;
    }
    start(async () => {
      const r = await action();
      push(r.ok ? "ok" : "error", r.ok ? okMessage : r.error);
      if (r.ok) {
        setReason("");
        setTime("");
        setNextDay(false);
        setData(await dayMarksAction(employmentId, ymd));
      }
    });
  }

  const plusOne = (d: string) => (d > ymd ? " (+1)" : "");

  return (
    <>
      <IconBtn icon={Icon.edit} label="Corregir marcaciones" onClick={openDialog} />
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        closable={!pending}
        title={`Corregir marcaciones · ${dateLabel}`}
        footer={
          <div className="flex justify-end">
            <Btn onClick={() => setOpen(false)} disabled={pending}>
              Cerrar
            </Btn>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="m-0 text-sm">
            <strong>{who}</strong>. Las marcaciones del equipo no se borran: una anulada deja de contar y se puede
            deshacer. Cada cambio queda registrado con su motivo, quién y cuándo, y recalcula el día.
          </p>

          <label className={LABEL}>
            Motivo (obligatorio)
            <textarea
              className={`${INPUT} h-auto min-h-16 py-2`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ej.: olvidó marcar la salida; lo confirmó el supervisor"
              disabled={pending}
            />
          </label>

          <section className="flex flex-col gap-1">
            <h3 className="m-0 text-sm font-semibold">Marcaciones que cuentan</h3>
            {!data ? (
              <p className="m-0 text-sm text-text/70">{pending ? "Cargando…" : "—"}</p>
            ) : data.marks.length === 0 ? (
              <p className="m-0 text-sm text-text/70">Ninguna.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.marks.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 border-b border-neutral-200 py-1 text-sm">
                    <span className="w-20 font-mono">
                      {m.time}
                      {plusOne(m.ymd)}
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span>
                        {m.manual ? <Tag variant="accent2">Agregada</Tag> : m.device}
                        <span className="text-text/60"> · {m.site}</span>
                      </span>
                      {m.correction && (
                        <span className="text-xs text-text/70">
                          {m.correction.actor}, {fmtWhen(m.correction.at)}: “{m.correction.reason}”
                        </span>
                      )}
                    </span>
                    {m.manual ? (
                      <Btn
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => revokeCorrectionAction(m.correction!.id), "Marcación agregada quitada.", false)}
                      >
                        Deshacer
                      </Btn>
                    ) : (
                      <Btn
                        variant="ghost"
                        disabled={pending}
                        onClick={() => run(() => voidMarkAction({ employmentId, logId: m.id, reason }), "Marcación anulada.")}
                      >
                        Anular
                      </Btn>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {data && data.voided.length > 0 && (
            <section className="flex flex-col gap-1">
              <h3 className="m-0 text-sm font-semibold">Anuladas</h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {data.voided.map((v) => (
                  <li key={v.logId} className="flex items-center gap-2 border-b border-neutral-200 py-1 text-sm text-text/70">
                    <span className="w-20 font-mono line-through">
                      {v.time}
                      {plusOne(v.ymd)}
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span>{v.device}</span>
                      <span className="text-xs">
                        {v.correction.actor}, {fmtWhen(v.correction.at)}: “{v.correction.reason}”
                      </span>
                    </span>
                    <Btn
                      variant="ghost"
                      disabled={pending}
                      onClick={() => run(() => revokeCorrectionAction(v.correction.id), "La marcación vuelve a contar.", false)}
                    >
                      Deshacer
                    </Btn>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-sm font-semibold">Agregar una marcación que falta</h3>
            <div className="flex flex-wrap items-end gap-3">
              <label className={LABEL}>
                Hora
                <input type="time" className={INPUT} value={time} onChange={(e) => setTime(e.target.value)} disabled={pending} />
              </label>
              {data && data.sites.length > 1 && (
                <label className={LABEL}>
                  Sede
                  <select className={INPUT} value={siteId} onChange={(e) => setSiteId(e.target.value)} disabled={pending}>
                    {data.sites.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="flex items-center gap-2 pb-2 text-sm">
                <input type="checkbox" checked={nextDay} onChange={(e) => setNextDay(e.target.checked)} disabled={pending} />
                del día siguiente (turno nocturno)
              </label>
            </div>
            <div>
              <Btn
                variant="primary"
                disabled={pending || !data || !time || siteId === ""}
                onClick={() =>
                  run(
                    () => addMarkAction({ employmentId, ymd, time, nextDay, siteId: Number(siteId), reason }),
                    "Marcación agregada."
                  )
                }
              >
                Agregar marcación
              </Btn>
            </div>
          </section>
        </div>
      </Dialog>
    </>
  );
}
