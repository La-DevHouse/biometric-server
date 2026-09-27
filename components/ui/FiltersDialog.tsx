"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Btn } from "@/components/ui/Btn";
import { IconBtn } from "@/components/ui/IconBtn";
import { FunnelIcon } from "@/components/ui/icons";

/**
 * Cascarón estándar para cualquier barra de filtros: ícono de embudo con
 * badge (cuántos hay aplicados) que abre un diálogo con los campos adentro
 * — en vez de una fila de <select> sueltos desordenando la barra superior
 * (Empleados, Asistencia). El estado de los filtros en sí (URL, qué cuenta
 * como "aplicado") lo maneja quien use este cascarón.
 */
export function FiltersDialog({
  activeCount,
  title = "Filtros",
  onClear,
  children,
}: {
  activeCount: number;
  title?: string;
  /** Si se pasa, agrega un botón "Limpiar filtros" (visible con activeCount > 0) que lo llama y cierra el diálogo. */
  onClear?: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="relative inline-flex">
        <IconBtn icon={<FunnelIcon />} label={title} onClick={() => setOpen(true)} />
        {activeCount > 0 && (
          <span className="absolute -top-[6px] -right-[6px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-[4px] font-mono text-2xs font-semibold leading-none text-white">
            {activeCount}
          </span>
        )}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title={title}>
        <div className="flex flex-col gap-3">
          {children}
          {onClear && activeCount > 0 && (
            <Btn
              type="button"
              variant="ghost"
              onClick={() => {
                onClear();
                setOpen(false);
              }}
            >
              Limpiar filtros
            </Btn>
          )}
        </div>
      </Dialog>
    </>
  );
}
