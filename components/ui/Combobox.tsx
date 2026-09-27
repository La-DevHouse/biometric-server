"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/cx";
import { FIELD_INPUT } from "./fieldStyles";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Texto secundario que también se busca y se muestra en gris (ej. el RIF). */
  hint?: string;
}

/** Minúsculas y sin acentos: "Farmacía" encuentra "farmacia" y viceversa. */
function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Select con búsqueda (docs/11 U6) — para listas largas como las ~40 empresas
 * de ALCO. Se escribe para filtrar (nombre + `hint`, sin distinguir acentos ni
 * mayúsculas), ↑↓ para moverse, Enter para elegir, Esc para cerrar. El valor
 * elegido viaja en un `<input type="hidden" name>`, así funciona dentro de
 * cualquier `<form action>` igual que un `<select>`.
 */
export function Combobox({
  name,
  options,
  value,
  defaultValue,
  onChange,
  placeholder = "Buscar…",
  emptyLabel,
  required,
  disabled,
  ariaLabel,
}: {
  name?: string;
  options: ComboboxOption[];
  /** Controlado. Si se omite, se usa `defaultValue` y el componente maneja su estado. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Si se pasa, agrega una primera opción con valor "" (ej. "— todas —"). */
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const listId = useId();
  const [inner, setInner] = useState(defaultValue ?? "");
  const selected = value ?? inner;
  const [query, setQuery] = useState<string | null>(null); // null = no se está escribiendo
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // Posición de la lista en coordenadas de viewport (position: fixed). Con
  // `absolute` la recortaba el `overflow-y-auto` del cuerpo del <Dialog> — y
  // ningún z-index escapa de un recorte por overflow. `fixed` sí (su bloque
  // contenedor es el viewport), y sigue dentro del <dialog>, en la capa
  // superior del navegador: un portal a <body> quedaría DEBAJO del modal.
  const [pos, setPos] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(
    null
  );

  const all = useMemo(
    () => (emptyLabel !== undefined ? [{ value: "", label: emptyLabel }, ...options] : options),
    [options, emptyLabel]
  );
  const current = all.find((o) => o.value === selected) ?? null;
  const filtered = useMemo(() => {
    if (!query) return all;
    const q = norm(query);
    return all.filter((o) => norm(`${o.label} ${o.hint ?? ""}`).includes(q));
  }, [all, query]);

  // Cerrar al hacer clic afuera.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Recalcular la posición al abrir, al hacer scroll (en cualquier contenedor)
  // y al cambiar el tamaño. Si abajo no hay lugar, abre hacia arriba.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (!r) return;
      const gap = 4;
      const margin = 8;
      const below = window.innerHeight - r.bottom - gap - margin;
      const above = r.top - gap - margin;
      const want = 256;
      if (below >= Math.min(want, 160) || below >= above) {
        setPos({ left: r.left, width: r.width, top: r.bottom + gap, maxHeight: Math.min(want, below) });
      } else {
        setPos({ left: r.left, width: r.width, bottom: window.innerHeight - r.top + gap, maxHeight: Math.min(want, above) });
      }
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  // Mantener visible la opción activa al moverse con el teclado.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(o: ComboboxOption) {
    if (value === undefined) setInner(o.value);
    onChange?.(o.value);
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[active]) {
        e.preventDefault(); // no enviar el form: Enter elige
        choose(filtered[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation(); // que no cierre el <dialog> que lo contiene
        setOpen(false);
        setQuery(null);
      }
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      {name && <input type="hidden" name={name} value={selected} />}
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && filtered[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        disabled={disabled}
        required={required && !selected}
        placeholder={current && query === null ? undefined : placeholder}
        value={query ?? current?.label ?? ""}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cx(FIELD_INPUT, "w-full pr-8")}
      />
      <span aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-text/60">
        ▾
      </span>
      {open && !disabled && pos && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          style={{ left: pos.left, width: pos.width, top: pos.top, bottom: pos.bottom, maxHeight: pos.maxHeight }}
          // font-sans/normal-case/tracking-normal: el combobox suele vivir dentro de un
          // FIELD_LABEL (mono, mayúsculas, tracking ancho) y las opciones lo heredaban.
          className="fixed z-50 m-0 list-none overflow-y-auto border border-text bg-surface p-0 font-sans normal-case tracking-normal text-text shadow-hard"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-text/60">Sin resultados</li>
          ) : (
            filtered.map((o, i) => (
              <li
                key={o.value || "__empty__"}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={o.value === selected}
                onMouseDown={(e) => e.preventDefault()} // no perder el foco antes del click
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
                className={cx(
                  "flex cursor-pointer items-baseline justify-between gap-[12px] px-(--control-px) py-[10px] text-sm",
                  i === active && "bg-accent-100",
                  o.value === selected && "font-semibold"
                )}
              >
                <span>{o.label}</span>
                {o.hint && <span className="font-mono text-xs text-neutral-700">{o.hint}</span>}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
