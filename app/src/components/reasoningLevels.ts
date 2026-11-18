/** Verified canonical policy vocabulary. Provider wire levels can be clamped separately. */
export const reasoningLevels = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
] as const;
export type ReasoningLevel = (typeof reasoningLevels)[number];
export function isReasoningLevel(value: unknown): value is ReasoningLevel {
  return reasoningLevels.includes(value as ReasoningLevel);
}
export function reasoningLabel(value: unknown): string {
  if (value === null) return "Gateway default";
  if (value === "xhigh") return "Extra high";
  return typeof value === "string" && value
    ? value[0].toUpperCase() + value.slice(1)
    : "Not reported";
}
export function reasoningProjection(info: unknown) {
  const record = info && typeof info === "object" ? (info as Record<string, unknown>) : {};
  return {
    requested: isReasoningLevel(record.reasoning_effort) ? record.reasoning_effort : null,
    wire: isReasoningLevel(record.reasoning_effort_wire) ? record.reasoning_effort_wire : null,
  };
}
