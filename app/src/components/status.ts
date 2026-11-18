export function connectionMessage(state: string): string {
  switch (state) {
    case "ready":
      return "Connected";
    case "auth-failed":
      return "Token rejected. Open Connection setup to scan a new code.";
    case "incompatible":
      return "Hermes was updated or this endpoint does not support shared sessions. The app may need updating.";
    case "connecting":
      return "Connecting to Hermes…";
    default:
      return "Connection unavailable. Check Tailscale and that the PC is awake. Showing saved sessions.";
  }
}

export function localMessageStatusLabel(status: string): string {
  if (status === "accepted") return "Accepted by Hermes";
  if (status === "completed") return "Finished · saved copy";
  if (status === "failed") return "Needs attention";
  return "Waiting to send";
}
export function formatUsage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const envelope = value as Record<string, unknown>;
  const usage =
    envelope.usage && typeof envelope.usage === "object"
      ? (envelope.usage as Record<string, unknown>)
      : envelope;
  const number = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0
      ? Math.round(v).toLocaleString("en-US")
      : null;
  const input = number(usage.input ?? usage.prompt),
    output = number(usage.output ?? usage.completion);
  const used = number(usage.context_used),
    max = number(usage.context_max);
  const parts = [
    input !== null ? `Input ${input}` : "",
    output !== null ? `Output ${output}` : "",
    used !== null ? `Context ${used}${max !== null ? ` / ${max}` : ""}` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")} tokens` : "";
}

export type ChatStatusInput = {
  connection: string;
  connectionGrace?: boolean;
  submitting: boolean;
  uploading: boolean;
  unavailable: boolean;
  running: boolean;
  streaming: boolean;
  promptCount: number;
  queuedCount: number;
  unknownCount: number;
  unsentCount: number;
  failedCount: number;
  acceptedCount: number;
};
export type ChatStatus = {
  label: string;
  detail?: string;
  tone: "active" | "warning";
  spinning: boolean;
};
export function chatStatus(input: ChatStatusInput): ChatStatus | null {
  const count = (n: number, singular: string, plural: string) =>
    `${n} ${n === 1 ? singular : plural}`;
  if (input.unavailable) return null; // The recovery card explains this condition.
  if (input.connection !== "ready" && input.connectionGrace) {
    if (input.promptCount)
      return {
        label: "Response needed",
        detail: "Open the request above",
        tone: "warning",
        spinning: false,
      };
    if (input.unknownCount)
      return {
        label: "Delivery status unknown",
        detail: "Review the queued message below",
        tone: "warning",
        spinning: false,
      };
    if (input.failedCount)
      return {
        label: "Saved item needs attention",
        detail: "Review the saved item below.",
        tone: "warning",
        spinning: false,
      };
    if (input.submitting) return { label: "Saving message", tone: "active", spinning: true };
    if (input.unsentCount)
      return { label: "Message saved", detail: "Waiting to send", tone: "active", spinning: false };
    return null;
  }
  if (input.connection !== "ready")
    return {
      label:
        input.connection === "auth-failed"
          ? "Token rejected"
          : input.connection === "incompatible"
            ? "Gateway incompatible"
            : input.connection === "connecting" || input.connection === "reconnecting"
              ? "Connecting to Hermes"
              : "Offline",
      detail: input.promptCount
        ? "Response needed · reconnect to respond"
        : input.connection === "auth-failed"
          ? "Open connection setup to scan a new code"
          : input.connection === "incompatible"
            ? "Shared sessions are unavailable on this gateway"
            : input.submitting
              ? "Preparing request…"
              : input.unsentCount
                ? `${count(input.unsentCount, "message", "messages")} saved for delivery`
                : "Messages are saved for delivery when sent",
      tone: "warning",
      spinning: false,
    };
  if (input.promptCount)
    return {
      label: "Response needed",
      detail: "Review the request above",
      tone: "warning",
      spinning: false,
    };
  if (input.unknownCount)
    return {
      label: "Delivery status unknown",
      detail: "Review the queued message below",
      tone: "warning",
      spinning: false,
    };
  if (input.submitting) return { label: "Sending", tone: "active", spinning: true };
  if (input.uploading)
    return {
      label: "Uploading image",
      detail: "Preparing your attachment",
      tone: "active",
      spinning: true,
    };
  if (input.unsentCount)
    return {
      label: "Sending",
      detail: `${count(input.unsentCount, "message", "messages")} waiting for delivery`,
      tone: "active",
      spinning: true,
    };
  if (input.running)
    return {
      label: input.streaming ? "Hermes is responding" : "Hermes is working",
      ...(input.queuedCount
        ? { detail: `${count(input.queuedCount, "message", "messages")} queued` }
        : {}),
      tone: "active",
      spinning: true,
    };
  if (input.failedCount)
    return {
      label: "Saved item needs attention",
      detail: "Review the saved item below.",
      tone: "warning",
      spinning: false,
    };
  if (input.queuedCount)
    return {
      label: "Queued with Hermes",
      detail: `${count(input.queuedCount, "message", "messages")} waiting`,
      tone: "active",
      spinning: false,
    };
  if (input.acceptedCount)
    return {
      label: "Accepted by Hermes",
      detail: "Delivery confirmed",
      tone: "active",
      spinning: false,
    };
  return null;
}

// Local persistence errors need attention even while connection notices are delayed.
export function showHomeError(error: string | null, connection: string, grace: boolean) {
  if (!error) return false;
  return (
    connection === "ready" || !grace || /\b(saved|save|draft|cache|queue|recovery)\b/i.test(error)
  );
}
