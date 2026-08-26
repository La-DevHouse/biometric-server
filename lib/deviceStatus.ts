export const ONLINE_THRESHOLD_MS = 30_000;

/** A device is "online" if it has reported within the last 30 seconds. */
export function isDeviceOnline(lastSeenAt: number | null | undefined): boolean {
  return !!lastSeenAt && Date.now() - lastSeenAt < ONLINE_THRESHOLD_MS;
}
