/**
 * `verify_mode` arrives inconsistently across code paths — sometimes a plain
 * device code ("1", "33"), sometimes a JSON-stringified array (handleRealtimeGlog
 * wraps array values as JSON: "[1]"), sometimes a literal string ("FP") seen in
 * older captures. There is no verified mapping from these codes to a human label
 * (e.g. "1" = fingerprint isn't confirmed against hardware), so this only
 * normalizes the JSON-array case for display — it does not invent meaning.
 */
export function formatVerifyMode(raw: string | null | undefined): string {
  if (!raw) return "—";
  if (raw.startsWith("[")) {
    try {
      return JSON.parse(raw).join(", ");
    } catch {
      return raw;
    }
  }
  return raw;
}
