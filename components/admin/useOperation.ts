"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OP_ACTION_INITIAL, MULTI_OP_ACTION_INITIAL, type OpActionState, type MultiOpActionState } from "@/lib/opActionState";
import type { OperationView } from "@/lib/operations";

const POLL_MS = 1500;

type OpAction = (prev: OpActionState, formData: FormData) => Promise<OpActionState>;

export interface UseOperationApi {
  /** Pasar a <form action={...}>. */
  formAction: (formData: FormData) => void;
  /** Error de arranque (validación) — se muestra dentro del propio diálogo, nunca como alerta aparte. */
  startError: string | null;
  /** Aviso adjunto a un arranque exitoso (ej. "el nombre se truncará a 8 caracteres"). */
  startWarning: string | null;
  /** Estado sondeado una vez que la operación tiene id; null antes de eso. */
  op: OperationView | null;
  /** true desde el envío hasta que la operación llega a un estado terminal — bloquea el diálogo mientras tanto. */
  busy: boolean;
  /** Limpia el estado local — llamar al cerrar el diálogo para que la próxima apertura empiece de cero. */
  reset: () => void;
}

/**
 * Encola una operación de alto nivel (server action que arranca una cadena
 * de comandos sobre el dispositivo) y sondea su resultado hasta que termina.
 * Reemplaza el patrón anterior de "encolar y confiar en un toast de fondo":
 * ahora el propio diálogo se queda bloqueado (`busy`) hasta que hay una
 * respuesta real, buena o mala — nada queda corriendo "atrás" sin que quien
 * lo pidió lo vea resolverse.
 *
 * `revalidatePath` en la server action de arranque invalida el caché en el
 * momento de ENCOLAR, no cuando el equipo confirma — la operación real (ej.
 * borrar un usuario) recién efectúa el cambio en la base cuando llega a
 * terminal, minutos después. Sin este `router.refresh()` la lista visible se
 * queda mostrando el estado viejo hasta que la persona recarga a mano.
 */
export function useOperation(action: OpAction): UseOperationApi {
  const router = useRouter();
  const [state, formAction, starting] = useActionState(action, OP_ACTION_INITIAL);
  const [op, setOp] = useState<OperationView | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.status !== "ok") return;
    let cancelled = false;
    const poll = async (id: number) => {
      const res = await fetch(`/api/operations/${id}`, { cache: "no-store" });
      if (cancelled || !res.ok) return;
      const data: OperationView = await res.json();
      if (cancelled) return;
      setOp(data);
      if (data.isTerminal) {
        router.refresh();
      } else {
        pollRef.current = setTimeout(() => poll(id), POLL_MS);
      }
    };
    poll(state.id);
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [state, router]);

  function reset() {
    setOp(null);
    if (pollRef.current) clearTimeout(pollRef.current);
  }

  return {
    formAction,
    startError: state.status === "error" ? state.message : null,
    startWarning: state.status === "ok" ? (state.warning ?? null) : null,
    op,
    busy: starting || (op !== null && !op.isTerminal),
    reset,
  };
}

type MultiOpAction = (prev: MultiOpActionState, formData: FormData) => Promise<MultiOpActionState>;

export interface UseMultiOperationApi {
  formAction: (formData: FormData) => void;
  startError: string | null;
  startWarning: string | null;
  /** Estado sondeado de cada operación disparada; vacío hasta que arrancan. */
  ops: OperationView[];
  /** true desde el envío hasta que TODAS las operaciones terminan. */
  busy: boolean;
  reset: () => void;
}

/** Igual que useOperation, pero para acciones que disparan una operación POR
 * elemento elegido (ej. varios equipos a la vez) — ver AddEmployeeToDeviceDialog.
 * Mismo motivo para el `router.refresh()`: sin él, la lista visible queda
 * mostrando el estado viejo hasta que todas las operaciones terminan. */
export function useMultiOperation(action: MultiOpAction): UseMultiOperationApi {
  const router = useRouter();
  const [state, formAction, starting] = useActionState(action, MULTI_OP_ACTION_INITIAL);
  const [ops, setOps] = useState<OperationView[]>([]);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state.status !== "ok") return;
    let cancelled = false;
    const poll = async (ids: number[]) => {
      const results = await Promise.all(
        ids.map(async (id) => {
          const res = await fetch(`/api/operations/${id}`, { cache: "no-store" });
          return res.ok ? ((await res.json()) as OperationView) : null;
        })
      );
      if (cancelled) return;
      const found = results.filter((r): r is OperationView => r !== null);
      setOps(found);
      if (found.some((r) => !r.isTerminal)) {
        pollRef.current = setTimeout(() => poll(ids), POLL_MS);
      } else {
        router.refresh();
      }
    };
    poll(state.ids);
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [state, router]);

  function reset() {
    setOps([]);
    if (pollRef.current) clearTimeout(pollRef.current);
  }

  const started = state.status === "ok";
  return {
    formAction,
    startError: state.status === "error" ? state.message : null,
    startWarning: started ? (state.warning ?? null) : null,
    ops,
    busy: starting || (started && (ops.length === 0 || ops.some((o) => !o.isTerminal))),
    reset,
  };
}
