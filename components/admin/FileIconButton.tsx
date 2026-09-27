"use client";

import { useRef, type ReactNode } from "react";
import { IconBtn } from "@/components/ui/IconBtn";

/**
 * Botón solo-ícono que abre el selector de archivos nativo — estandariza el
 * "Choose File" feo del input crudo al mismo estilo que "📷 Escanear...".
 * El `<input>` real queda oculto; este es solo el trigger visual.
 */
export function FileIconButton({
  icon,
  label,
  accept,
  disabled,
  onFile,
}: {
  icon: ReactNode;
  label: string;
  accept: string;
  disabled?: boolean;
  onFile: (file: File) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <>
      <IconBtn type="button" icon={icon} label={label} disabled={disabled} onClick={() => ref.current?.click()} />
      <input
        ref={ref}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // permite reelegir el mismo archivo después
          if (file) onFile(file);
        }}
      />
    </>
  );
}
