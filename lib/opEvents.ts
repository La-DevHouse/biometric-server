/**
 * OpTracker polls on its own schedule and stops when idle (see its own
 * comment). When a dialog/button starts a new operation, it needs a way to
 * wake that loop up immediately instead of waiting for the next 2s tick (or
 * not resuming at all if the loop had already gone idle) — a plain
 * browser event is the smallest thing that does that without a state
 * library or prop-drilling from every action button up to the tracker.
 */
export const OPERATION_STARTED_EVENT = "biometric:operation-started";

export function notifyOperationStarted() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(OPERATION_STARTED_EVENT));
  }
}
