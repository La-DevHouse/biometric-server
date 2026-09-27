"use client";

import { startTransition, useEffect, useRef, type FormEvent } from "react";

/**
 * Envía un formulario a una server action SIN que React lo vacíe si falla.
 *
 * Con `<form action={formAction}>`, React 19 resetea el formulario apenas la
 * action termina — también cuando devuelve un error de validación, así que la
 * persona pierde todo lo que escribió. Acá el submit va por `onSubmit`
 * (preventDefault + dispatch dentro de una transición, que es lo que hace
 * `action=` por dentro, sin el reset), y el formulario se limpia solo cuando
 * la action devuelve `status: "ok"` — igual que antes en el caso feliz.
 *
 * Uso: `const onSubmit = useFormSubmit(formAction, state)` y `<form onSubmit={onSubmit}>`.
 * `isPending` de useActionState sigue funcionando igual.
 */
export function useFormSubmit(
  dispatch: (formData: FormData) => void,
  state?: { status: string } | null
): (e: FormEvent<HTMLFormElement>) => void {
  const lastForm = useRef<HTMLFormElement | null>(null);

  useEffect(() => {
    if (state?.status === "ok") lastForm.current?.reset();
  }, [state]);

  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    lastForm.current = form;
    // `submitter`: incluye el name/value del botón que envió, como el submit nativo.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = submitter ? new FormData(form, submitter) : new FormData(form);
    startTransition(() => dispatch(fd));
  };
}
