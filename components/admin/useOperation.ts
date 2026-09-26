"use client";

import { useActionState, useEffect, useRef } from "react";
import { OP_ACTION_INITIAL, MULTI_OP_ACTION_INITIAL, type OpActionState, type MultiOpActionState } from "@/lib/opActionState";
import { useOperationsTracker } from "./OperationsTracker";

type OpAction = (prev: OpActionState, formData: FormData) => Promise<OpActionState>;
type MultiOpAction = (prev: MultiOpActionState, formData: FormData) => Promise<MultiOpActionState>;

export interface UseOperationOptions {
  /** Se llama apenas la operación quedó encolada — el diálogo se cierra acá. */
  onStarted?: () => void;
}

export interface UseOperationApi {
  /** Pasar a <form action={...}>. */
  formAction: (formData: FormData) => void;
  /** Error de arranque (validación) — se muestra dentro del propio diálogo, nunca como alerta aparte. */
  startError: string | null;
  /** true solo mientras la server action encola — el seguimiento no bloquea nada. */
  busy: boolean;
}

/**
 * Encola una operación de alto nivel (server action que arranca una cadena
 * de comandos sobre el dispositivo) y se la entrega al panel global
 * "Procesando" (OperationsTracker), que la sigue hasta el final, muestra cada
 * paso y refresca la página cuando termina. El diálogo que la lanzó NO se
 * queda bloqueado esperando al equipo: se cierra en `onStarted`, y el aviso
 * de arranque (ej. "el nombre se truncará a 8 caracteres") viaja al panel.
 */
export function useOperation(action: OpAction, opts: UseOperationOptions = {}): UseOperationApi {
  const { track } = useOperationsTracker();
  const [state, formAction, starting] = useActionState(action, OP_ACTION_INITIAL);
  const onStartedRef = useRef(opts.onStarted);
  useEffect(() => {
    onStartedRef.current = opts.onStarted;
  });

  useEffect(() => {
    if (state.status !== "ok") return;
    track([state.id], state.warning);
    onStartedRef.current?.();
  }, [state, track]);

  return {
    formAction,
    startError: state.status === "error" ? state.message : null,
    busy: starting,
  };
}

/** Igual que useOperation, para acciones que disparan una operación POR
 * elemento elegido (ej. varios equipos a la vez) — ver AddEmployeeToDeviceDialog. */
export function useMultiOperation(action: MultiOpAction, opts: UseOperationOptions = {}): UseOperationApi {
  const { track } = useOperationsTracker();
  const [state, formAction, starting] = useActionState(action, MULTI_OP_ACTION_INITIAL);
  const onStartedRef = useRef(opts.onStarted);
  useEffect(() => {
    onStartedRef.current = opts.onStarted;
  });

  useEffect(() => {
    if (state.status !== "ok") return;
    track(state.ids, state.warning);
    onStartedRef.current?.();
  }, [state, track]);

  return {
    formAction,
    startError: state.status === "error" ? state.message : null,
    busy: starting,
  };
}
