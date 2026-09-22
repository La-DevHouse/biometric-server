"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { FiltersDialog } from "@/components/ui/FiltersDialog";
import { FIELD_LABEL as LABEL } from "@/components/ui/fieldStyles";

export interface DeviceOption {
  dev_id: string;
  label: string;
}

export interface UserOption {
  dev_id: string;
  user_id: string;
  label: string;
}

const INPUT_CLASS =
  "min-h-9 px-2.5 text-sm bg-surface border border-divider rounded-none disabled:opacity-60 w-full";

/**
 * user_id is only unique WITHIN a device (two devices can both have a
 * user "1"), so the Usuario filter only makes sense once a specific
 * Dispositivo is chosen — it's disabled on "Todos" rather than trying to
 * disambiguate a combined cross-device list.
 */
export function AttendanceFilters({
  devices,
  users,
}: {
  devices: DeviceOption[];
  users: UserOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const dev = searchParams.get("dev") ?? "";
  const user = searchParams.get("user") ?? "";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  const activeCount = [dev, user, from, to].filter(Boolean).length;

  const usersForDevice = dev ? users.filter((u) => u.dev_id === dev) : [];

  function update(patch: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  return (
    <FiltersDialog activeCount={activeCount} onClear={() => startTransition(() => router.push(pathname))}>
      <label className={LABEL}>
        Dispositivo
        <select
          className={INPUT_CLASS}
          value={dev}
          disabled={isPending}
          onChange={(e) => update({ dev: e.target.value, user: "" })}
        >
          <option value="">Todos</option>
          {devices.map((d) => (
            <option key={d.dev_id} value={d.dev_id}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        Usuario
        <select
          className={INPUT_CLASS}
          value={user}
          disabled={isPending || !dev}
          onChange={(e) => update({ user: e.target.value })}
          title={dev ? undefined : "Selecciona un dispositivo primero"}
        >
          <option value="">Todos</option>
          {usersForDevice.map((u) => (
            <option key={u.user_id} value={u.user_id}>
              {u.label}
            </option>
          ))}
        </select>
      </label>

      <label className={LABEL}>
        Desde
        <input
          type="date"
          className={INPUT_CLASS}
          value={from}
          disabled={isPending}
          onChange={(e) => update({ from: e.target.value })}
        />
      </label>

      <label className={LABEL}>
        Hasta
        <input
          type="date"
          className={INPUT_CLASS}
          value={to}
          disabled={isPending}
          onChange={(e) => update({ to: e.target.value })}
        />
      </label>
    </FiltersDialog>
  );
}
