"use client";

import { useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Grupo colapsable de la lista de Empresas (docs/11 C1): la fila del grupo
 * expande/colapsa sus empresas (el grupo no tiene página propia). Colapsado
 * por defecto. Las acciones del grupo (editar, activar/desactivar) cortan la
 * propagación del click — también las de sus diálogos, que viven adentro.
 */
export function CollapsibleGroupRows({
  name,
  meta,
  status,
  actions,
  colSpan,
  defaultOpen = false,
  children,
}: {
  name: ReactNode;
  meta: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  /** Columnas que ocupa el nombre (todas menos estado y acciones). */
  colSpan: number;
  /** Abierto al cargar (ej. se llegó desde el buscador con ?grupo=). */
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      <tr
        className="cursor-pointer bg-chrome hover:bg-accent-100"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <td className="border-b border-neutral-200 px-[14px] py-[11px]" colSpan={colSpan}>
          <button
            type="button"
            className="inline-flex items-center gap-2 border-0 bg-transparent p-0 text-left font-sans text-sm text-text"
            aria-expanded={open}
            onClick={(e) => {
              e.stopPropagation();
              setOpen((o) => !o);
            }}
          >
            <Chevron open={open} />
            <span className="font-heading font-semibold">{name}</span>
          </button>{" "}
          <span className="text-xs text-text/70">{meta}</span>
        </td>
        <td className="border-b border-neutral-200 px-[14px] py-[11px]">{status}</td>
        <td className="border-b border-neutral-200 px-[14px] py-[11px]" onClick={(e) => e.stopPropagation()}>
          {actions}
        </td>
      </tr>
      {open && children}
    </>
  );
}

/** Versión mobile: tarjeta compacta del grupo; sus empresas debajo, al expandir. */
export function CollapsibleGroupCard({
  name,
  meta,
  status,
  actions,
  defaultOpen = false,
  children,
}: {
  name: ReactNode;
  meta: ReactNode;
  status: ReactNode;
  actions: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 border border-divider border-l-[3px] border-l-accent2 bg-chrome px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent p-0 text-left font-sans text-sm text-text"
        >
          <Chevron open={open} />
          <span className="min-w-0">
            <span className="block truncate font-heading font-semibold">{name}</span>
            <span className="block text-xs text-text/70">{meta}</span>
          </span>
        </button>
        {status}
        <span className="flex items-center gap-1">{actions}</span>
      </div>
      {open && <div className="flex flex-col gap-1.5 pl-4">{children}</div>}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <span aria-hidden className={cx("inline-block w-3 text-xs transition-transform", open && "rotate-90")}>
      ▶
    </span>
  );
}
