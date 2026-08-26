"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";

export interface DeviceOption {
  dev_id: string;
  label: string;
}

/**
 * A <select> that updates a query param and navigates, keeping filters in
 * the URL (shareable, and correct after a refresh) instead of client-only
 * state. useTransition marks the navigation as non-blocking so typing/
 * clicking elsewhere isn't frozen while the new server data loads.
 */
export function DeviceSelect({
  devices,
  paramName = "dev",
  allowAll = true,
}: {
  devices: DeviceOption[];
  paramName?: string;
  allowAll?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const current = searchParams.get(paramName) ?? "";

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const params = new URLSearchParams(searchParams.toString());
    if (e.target.value) params.set(paramName, e.target.value);
    else params.delete(paramName);
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <select
      className="min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none disabled:opacity-60"
      value={current}
      onChange={onChange}
      disabled={isPending}
    >
      {allowAll && <option value="">Todos</option>}
      {devices.map((d) => (
        <option key={d.dev_id} value={d.dev_id}>
          {d.label}
        </option>
      ))}
    </select>
  );
}
