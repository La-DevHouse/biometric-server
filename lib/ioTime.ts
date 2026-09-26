// io_time del protocolo = "YYYYMMDDhhmmss" como texto, en hora local de la sede.

/** "YYYY-MM-DD" (input date) → límite de día comparable con io_time. */
export function toDayBound(dateInput: string, edge: "start" | "end"): string {
  const digits = dateInput.replaceAll("-", "");
  return digits + (edge === "start" ? "000000" : "235959");
}

/** io_time → "DD/MM/YYYY hh:mm:ss". */
export function formatIoTime(ioTime: string | null): string {
  if (!ioTime || ioTime.length < 14) return ioTime || "—";
  const y = ioTime.slice(0, 4);
  const mo = ioTime.slice(4, 6);
  const d = ioTime.slice(6, 8);
  const h = ioTime.slice(8, 10);
  const mi = ioTime.slice(10, 12);
  const s = ioTime.slice(12, 14);
  return `${d}/${mo}/${y} ${h}:${mi}:${s}`;
}
