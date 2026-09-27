"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cx } from "@/lib/cx";
import type { SearchHit, SearchKind } from "@/lib/search";

const KIND: Record<SearchKind, { label: string; icon: string }> = {
  empleado: { label: "Empleados", icon: "◉" },
  empresa: { label: "Empresas", icon: "▢" },
  equipo: { label: "Equipos", icon: "▤" },
  sede: { label: "Sedes", icon: "⌖" },
  grupo: { label: "Grupos", icon: "▣" },
  horario: { label: "Horarios", icon: "◫" },
  puesto: { label: "Puestos", icon: "☰" },
};
const ORDER: SearchKind[] = ["empleado", "empresa", "equipo", "sede", "grupo", "horario", "puesto"];

const RECENTS_KEY = "alco.search.recent";
const MAX_RECENTS = 8;

// localStorage puede no existir o tirar (modo privado, bloqueado): siempre con try/catch.
function loadRecents(): SearchHit[] {
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? (JSON.parse(raw) as SearchHit[]) : [];
    return Array.isArray(parsed) ? parsed.filter((h) => h && h.href && h.kind in KIND).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}
function saveRecent(hit: SearchHit) {
  try {
    const next = [hit, ...loadRecents().filter((h) => h.href !== hit.href)].slice(0, MAX_RECENTS);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    /* sin almacenamiento: no hay recientes, nada más */
  }
}

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Resalta la coincidencia sin distinguir acentos (NFD conserva el largo de cada letra base + marca). */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = norm(query.trim());
  if (!q) return <>{text}</>;
  // Mapa índice-normalizado → índice-original, letra por letra.
  let flat = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const n = norm(text[i]);
    for (let k = 0; k < n.length; k++) {
      flat += n[k];
      map.push(i);
    }
  }
  const at = flat.indexOf(q);
  if (at < 0) return <>{text}</>;
  const start = map[at];
  const end = map[at + q.length - 1] + 1;
  return (
    <>
      {text.slice(0, start)}
      <mark className="bg-accent-100 font-semibold text-text">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

/**
 * Buscador global estilo Zoho (docs/11 S1–S4): una barra en el encabezado que
 * abre una paleta centrada; también con ⌘K / Ctrl K desde cualquier pantalla.
 * Solo objetos (sin acciones), agrupados por tipo; sin texto muestra los vistos
 * recientemente (en el navegador). ↑↓ para moverse, Enter abre, Esc cierra.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [recents, setRecents] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const openPalette = useCallback(() => {
    setRecents(loadRecents());
    setQuery("");
    setHits([]);
    setActive(0);
    setOpen(true);
  }, []);

  // Atajo global ⌘K / Ctrl K.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, openPalette]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Búsqueda con un pequeño debounce; la respuesta vieja se descarta.
  const trimmed = query.trim();
  useEffect(() => {
    if (!open || trimmed.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, { signal: ctrl.signal });
        if (res.ok) {
          const data = (await res.json()) as { hits: SearchHit[] };
          setHits(data.hits);
          setActive(0);
        }
      } catch {
        /* abortada o sin red: se queda lo anterior */
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [trimmed, open]);

  const showingRecents = trimmed.length < 2;
  const list = showingRecents ? recents : hits;
  // Agrupado por tipo, en orden fijo; el índice plano sirve para el teclado.
  const groups = useMemo(() => {
    if (showingRecents) return list.length ? [{ kind: null as SearchKind | null, items: list }] : [];
    return ORDER.map((k) => ({ kind: k as SearchKind | null, items: list.filter((h) => h.kind === k) })).filter(
      (g) => g.items.length > 0
    );
  }, [list, showingRecents]);
  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function go(hit: SearchHit) {
    saveRecent(hit);
    setOpen(false);
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (flat[active]) go(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
  let index = -1;

  return (
    <>
      <button
        type="button"
        onClick={openPalette}
        aria-label="Buscar (⌘K)"
        className="ml-auto flex h-(--control-h) w-(--control-h) flex-none cursor-pointer items-center justify-center gap-[8px] border border-neutral-500 bg-surface text-sm text-neutral-700 hover:border-text md:w-[370px] md:justify-start md:px-[12px] md:text-left whitespace-nowrap"
      >
        <span aria-hidden className="text-[20px] leading-none max-md:text-[35px]">⌕</span>
        <span className="hidden md:inline">Buscar empresas, empleados, equipos…</span>
        <kbd className="ml-auto hidden border border-divider px-[6px] font-mono text-2xs text-neutral-700 md:inline">
          {isMac ? "⌘K" : "Ctrl K"}
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-text/40 px-4 pt-[12vh]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Buscador"
            className="flex max-h-[70vh] w-full max-w-xl flex-col border border-text bg-surface shadow-hard"
            onKeyDown={onKeyDown}
          >
            <div className="flex items-center gap-2 border-b border-divider px-3">
              <span aria-hidden className="text-lg text-text/60">⌕</span>
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded
                aria-controls="palette-list"
                aria-activedescendant={flat[active] ? `palette-${active}` : undefined}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por nombre, cédula, RIF, serie…"
                className="h-12 min-w-0 flex-1 border-0 bg-transparent text-base text-text outline-none"
                autoComplete="off"
                spellCheck={false}
              />
              {loading && <span className="font-mono text-2xs text-text/50">buscando…</span>}
              <kbd className="border border-divider px-1.5 font-mono text-2xs text-text/60">Esc</kbd>
            </div>

            <div ref={listRef} id="palette-list" role="listbox" className="flex-1 overflow-y-auto py-1">
              {groups.length === 0 ? (
                <p className="m-0 px-4 py-6 text-center text-sm text-text/60">
                  {showingRecents
                    ? "Escribí al menos 2 letras. Lo que abras desde acá aparece como reciente."
                    : loading
                      ? "Buscando…"
                      : "Sin resultados."}
                </p>
              ) : (
                groups.map((g) => (
                  <div key={g.kind ?? "recent"} role="group" aria-label={g.kind ? KIND[g.kind].label : "Recientes"}>
                    <p className="m-0 px-4 pb-1 pt-2 font-mono text-2xs uppercase tracking-[0.14em] text-text/60">
                      {g.kind ? KIND[g.kind].label : "Vistos recientemente"}
                    </p>
                    {g.items.map((h) => {
                      index += 1;
                      const i = index;
                      return (
                        <div
                          key={`${h.kind}-${h.id}`}
                          id={`palette-${i}`}
                          data-index={i}
                          role="option"
                          aria-selected={i === active}
                          onMouseEnter={() => setActive(i)}
                          onClick={() => go(h)}
                          className={cx(
                            "flex cursor-pointer items-center gap-3 px-4 py-2",
                            i === active && "bg-accent-100"
                          )}
                        >
                          <span aria-hidden className="w-4 flex-none text-center font-mono text-text/60">
                            {KIND[h.kind].icon}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm text-text">
                              <Highlight text={h.title} query={showingRecents ? "" : trimmed} />
                            </span>
                            {h.subtitle && (
                              <span className="block truncate text-xs text-text/60">
                                <Highlight text={h.subtitle} query={showingRecents ? "" : trimmed} />
                              </span>
                            )}
                          </span>
                          {showingRecents && (
                            <span className="flex-none font-mono text-2xs text-text/50">{KIND[h.kind].label}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>

            <div className="flex gap-4 border-t border-divider px-4 py-2 font-mono text-2xs text-text/50">
              <span>↑↓ moverse</span>
              <span>Enter abrir</span>
              <span>Esc cerrar</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
