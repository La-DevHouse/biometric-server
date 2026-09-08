"use client";

import { cx } from "@/lib/cx";
import { Btn } from "@/components/ui/Btn";
import type { OperationView } from "@/lib/operations";

/** Estado intermedio de una operación en curso — sin botón, el diálogo está bloqueado. */
export function OperationProgress({ op }: { op: OperationView }) {
  return (
    <div className="flex items-center gap-2 text-sm text-text/85">
      <span className="w-2 h-2 rounded-full bg-accent animate-op-pulse" aria-hidden />
      {op.progressLabel ? `${op.progressLabel} · ` : ""}
      {op.stageLabel}…
    </div>
  );
}

const STAGE_TONE: Record<string, string> = {
  done: "text-accent",
  mismatch: "text-accent2",
  error: "text-text",
  canceled: "text-text/75",
};

/** Resultado terminal — siempre exige un clic explícito para cerrar el diálogo. */
export function OperationResult({ op, onClose }: { op: OperationView; onClose: () => void }) {
  return (
    <div className="flex flex-col gap-3">
      <p className={cx("text-sm m-0", STAGE_TONE[op.stage] ?? "text-text")}>
        {op.stage === "done" ? (op.note ?? "Listo.") : `${op.stageLabel}${op.note ? " — " + op.note : ""}`}
      </p>
      <Btn variant="primary" onClick={onClose}>
        Cerrar
      </Btn>
    </div>
  );
}
