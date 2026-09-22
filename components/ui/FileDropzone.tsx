"use client";

import { useId, useRef, useState, type DragEvent } from "react";
import { cx } from "@/lib/cx";
import { Icon } from "./icons";

export type DropzoneState =
  | { status: "idle" }
  | { status: "loaded"; name: string; meta: string }
  | { status: "error"; message: string; hint?: string };

const STRIPES = "bg-[repeating-linear-gradient(135deg,#fff_0px,#fff_6px,#f6f7f8_6px,#f6f7f8_12px)]";

/**
 * Zona de drag-and-drop real, con 3 estados visuales (vacío/cargado/error) —
 * reemplaza al botón simple de "elegir archivo" donde el archivo ES el
 * contenido principal del campo (Logo). Donde además hay una alternativa de
 * cámara en vivo (RIF, cédula) se mantiene el par de íconos existente: una
 * zona de drop no reemplaza "sacar una foto ahora", son dos acciones
 * distintas — así que este componente no reemplaza esos flujos.
 */
export function FileDropzone({
  label,
  accept,
  hint,
  state,
  onFile,
  onRemove,
  disabled,
}: {
  label: string;
  accept: string;
  hint: string;
  state: DropzoneState;
  onFile: (file: File) => void;
  onRemove?: () => void;
  disabled?: boolean;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <div className="flex flex-col gap-[5px]">
      <span className="font-mono text-xs uppercase tracking-[0.1em] text-neutral-800">{label}</span>

      {state.status === "loaded" ? (
        <div className="flex items-center gap-3 p-3 bg-surface border border-accent">
          <span className="w-8 h-8 flex-none flex items-center justify-center bg-accent text-white text-lg leading-none">
            ✓
          </span>
          <span className="flex flex-col gap-px min-w-0 flex-1">
            <span className="text-[13px] font-semibold truncate">{state.name}</span>
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-neutral-700">{state.meta}</span>
          </span>
          {onRemove && (
            <button
              type="button"
              title="Quitar archivo"
              aria-label="Quitar archivo"
              onClick={onRemove}
              className="w-7 h-7 flex-none flex items-center justify-center bg-transparent border border-neutral-500 hover:border-danger-600 text-danger-600 text-lg leading-none cursor-pointer"
            >
              ×
            </button>
          )}
        </div>
      ) : state.status === "error" ? (
        <div className="flex items-center gap-3 p-3 bg-danger-100 border border-dashed border-danger-600">
          <span className="w-8 h-8 flex-none flex items-center justify-center border border-danger-600 text-danger-600 text-lg leading-none">
            !
          </span>
          <span className="flex flex-col gap-px">
            <span className="text-[13px] font-semibold text-danger-700">{state.message}</span>
            {state.hint && (
              <span className="font-mono text-xs uppercase tracking-[0.1em] text-danger-700">{state.hint}</span>
            )}
          </span>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={disabled ? undefined : handleDrop}
          className={cx(
            "flex items-center gap-3 p-3 border border-dashed cursor-pointer",
            STRIPES,
            dragOver ? "border-accent" : "border-neutral-500 hover:border-accent",
            disabled && "opacity-45 cursor-not-allowed pointer-events-none"
          )}
        >
          <span className="w-8 h-8 flex-none flex items-center justify-center border border-text bg-surface text-lg leading-none">
            {Icon.upload}
          </span>
          <span className="flex flex-col gap-px min-w-0">
            <span className="text-[13px] font-semibold">
              Arrastrá el archivo o <span className="text-accent-700 border-b border-accent">buscá en el equipo</span>
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.1em] text-neutral-700">{hint}</span>
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept={accept}
            disabled={disabled}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) onFile(file);
            }}
          />
        </label>
      )}
    </div>
  );
}
