import type { ModelChoice } from "./selections";

export const conversationModes = [
  { label: "Fast", model: "gpt-6-luna", provider: "openai-codex", reasoning: "none" },
  { label: "Balanced", model: "gpt-6.1-sol", provider: "openai-codex", reasoning: "medium" },
  { label: "Deep", model: "gpt-6-astra", provider: "openai-codex", reasoning: "high" },
] as const;
export type ConversationMode = (typeof conversationModes)[number];

export function modeAvailable(mode: ConversationMode, choices: readonly ModelChoice[]) {
  return choices.some(
    (choice) =>
      choice.provider === mode.provider && choice.model === mode.model && !choice.disabled,
  );
}

/** Label only fully reported matching authority state; never infer policy from a local selection. */
export function currentConversationMode(value: unknown): string {
  const info = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return (
    conversationModes.find(
      (mode) =>
        info.model === mode.model &&
        info.provider === mode.provider &&
        info.reasoning_effort === mode.reasoning &&
        info.reasoning_effort_wire === mode.reasoning,
    )?.label ?? "Custom"
  );
}

/** One pending native confirmation at a time; consuming it is irreversible. */
export class ModeConfirmationOwner {
  private pending: object | null = null;
  private flight: object | null = null;
  issue(): object {
    const token = {};
    this.pending = token;
    return token;
  }
  invalidate() {
    this.pending = null;
  }
  consume(token: object): boolean {
    if (this.pending !== token) return false;
    this.pending = null;
    return true;
  }
  busy() {
    return this.flight !== null;
  }
  begin(): object | null {
    if (this.flight) return null;
    const flight = {};
    this.flight = flight;
    return flight;
  }
  finish(flight: object): boolean {
    if (this.flight !== flight) return false;
    this.flight = null;
    return true;
  }
  reset() {
    this.pending = null;
    this.flight = null;
  }
}
