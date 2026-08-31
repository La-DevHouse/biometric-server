"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

const initial: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <form
        action={action}
        className="w-full max-w-[340px] flex flex-col gap-3 rounded-lg border border-divider bg-white p-6"
      >
        <div className="mb-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text/50">
            Marcaje
          </p>
          <h1 className="text-lg font-semibold text-text">Ingreso</h1>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text/70">Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="username"
            autoFocus
            className="rounded border border-divider px-3 py-2 text-sm outline-none focus:border-text/40"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-text/70">Contraseña</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded border border-divider px-3 py-2 text-sm outline-none focus:border-text/40"
          />
        </label>

        {state.error && (
          <p className="text-sm text-red-600" role="alert">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-1 rounded bg-text px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </div>
  );
}
