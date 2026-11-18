/** Canonical pending includes the active admission as well as FIFO waiters. */
export function waitingPrompts<T>(pending: T[]): T[] {
  return pending.filter(
    (value) =>
      !!value && typeof value === "object" && (value as { status?: unknown }).status === "queued",
  );
}
export function unknownPrompts<T>(pending: T[]): T[] {
  return pending.filter(
    (value) =>
      !!value && typeof value === "object" && (value as { status?: unknown }).status === "unknown",
  );
}
