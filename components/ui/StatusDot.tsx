import { cx } from "@/lib/cx";

/**
 * Online/offline indicator. The design's live-tracker dot (.dot / omPulse)
 * pulses while something is in flight — a device being simply "online" is
 * steady, so this deliberately does not use animate-op-pulse.
 */
export function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={cx(
        "inline-block w-[9px] h-[9px] flex-none rounded-full",
        online ? "bg-accent" : "border border-neutral-400 bg-transparent"
      )}
      aria-hidden
    />
  );
}
