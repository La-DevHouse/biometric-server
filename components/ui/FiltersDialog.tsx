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
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-bg">
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
