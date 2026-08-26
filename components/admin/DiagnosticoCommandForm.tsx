"use client";

import { useActionState, useState } from "react";
import { queueCommandAction, type QueueCommandState } from "@/app/admin/actions";
import { COMMAND_TEMPLATES } from "@/lib/commandTemplates";
import { Btn } from "@/components/ui/Btn";

const INPUT_CLASS = "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none w-full";

const INITIAL_STATE: QueueCommandState = { status: "idle" };

export function DiagnosticoCommandForm({
  devices,
}: {
  devices: { dev_id: string; label: string }[];
}) {
  const [state, formAction, isPending] = useActionState(queueCommandAction, INITIAL_STATE);
  const [cmdCode, setCmdCode] = useState("");
  const template = cmdCode ? COMMAND_TEMPLATES[cmdCode] : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-3 max-w-md">
      <label className="flex flex-col gap-1 text-xs text-text/70">
        Dispositivo
        <select name="dev_id" required className={INPUT_CLASS} defaultValue="">
          <option value="" disabled>
            Selecciona un equipo…
          </option>
          {devices.map((d) => (
            <option key={d.dev_id} value={d.dev_id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs text-text/70">
        Comando
        <select
          name="cmd_code"
          required
          className={INPUT_CLASS}
          value={cmdCode}
          onChange={(e) => setCmdCode(e.target.value)}
        >
          <option value="" disabled>
            Selecciona un comando…
          </option>
          {Object.entries(COMMAND_TEMPLATES).map(([code, t]) => (
            <option key={code} value={code}>
              {code} — {t.label}
            </option>
          ))}
        </select>
      </label>

      {template?.params &&
        Object.entries(template.params).map(([key, placeholder]) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-text/70">
            {key}
            <input
              type="text"
              name={`param:${key}`}
              placeholder={placeholder}
              className={INPUT_CLASS}
            />
          </label>
        ))}

      <Btn type="submit" variant="primary" disabled={isPending}>
        {isPending ? "Encolando…" : "Encolar comando"}
      </Btn>

      {state.status === "ok" && (
        <p className="text-xs text-accent-800">Comando #{state.transId} encolado.</p>
      )}
      {state.status === "error" && <p className="text-xs text-red-700">{state.message}</p>}
    </form>
  );
}
