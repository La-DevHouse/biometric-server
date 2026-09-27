"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

const GAP = 6;
const MARGIN = 8;

/**
 * Globo de tooltip de los botones-ícono. Se muestra con hover o foco del
 * elemento padre (el `<span class="group/tip">` que envuelve al botón).
 *
 * `position: fixed` con coordenadas calculadas, no `absolute`: dentro de una
 * tabla (wrapper con overflow-x-auto) o del cuerpo de un diálogo, un globo
 * absoluto queda recortado — y ningún z-index escapa de un recorte por
 * overflow. Fijo, se sale del recorte, se acomoda dentro de la pantalla (no se
 * corta contra el borde derecho) y pasa abajo si arriba no hay lugar. Sigue en
 * el mismo árbol DOM, así que también funciona dentro de un <dialog> modal.
 */
export function Tip({ label, side = "top" }: { label: string; side?: "top" | "bottom" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const host = ref.current?.parentElement;
    if (!host) return;
    const show = () => setAnchor(host.getBoundingClientRect());
    const hide = () => {
      setAnchor(null);
      setPos(null);
    };
    host.addEventListener("mouseenter", show);
    host.addEventListener("mouseleave", hide);
    host.addEventListener("focusin", show);
    host.addEventListener("focusout", hide);
    // Un click abre un diálogo o navega: el globo no debe quedar colgado.
    host.addEventListener("click", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      host.removeEventListener("mouseenter", show);
      host.removeEventListener("mouseleave", hide);
      host.removeEventListener("focusin", show);
      host.removeEventListener("focusout", hide);
      host.removeEventListener("click", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  // Medir el globo ya renderizado y ubicarlo dentro del viewport.
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.min(Math.max(anchor.left + anchor.width / 2 - width / 2, MARGIN), vw - width - MARGIN);
    const above = anchor.top - GAP - height;
    const below = anchor.bottom + GAP;
    const top =
      side === "top" ? (above >= MARGIN ? above : below) : below + height <= vh - MARGIN ? below : above;
    setPos({ left, top });
  }, [anchor, side]);

  return (
    <span
      ref={ref}
      role="tooltip"
      aria-hidden
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      className={
        "pointer-events-none fixed z-[1000] whitespace-nowrap border border-text bg-text px-[8px] py-[4px] " +
        "font-sans text-xs font-normal normal-case tracking-normal text-white shadow-hard transition-opacity duration-100 " +
        (anchor && pos ? "opacity-100" : "opacity-0")
      }
    >
      {label}
    </span>
  );
}
