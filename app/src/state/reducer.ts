import type { GatewayEvent, Snapshot } from "@hermes-mobile/protocol";
import type { ChatState, SessionRow } from "../types";

const obj = (v: unknown): Record<string, any> =>
  v && typeof v === "object" ? (v as Record<string, any>) : {};
function activityKey(event: GatewayEvent): string | null {
  const p = obj(event.payload),
    type = String(event.type);
  const turn = p.turn_id ?? event.admission_id ?? event.execution_generation ?? "";
  if (/^(reasoning|thinking)\./.test(type)) return `reasoning:${turn}`;
  const tool = p.tool_call_id ?? p.tool_id ?? p.id;
  return type.startsWith("tool.") && tool != null ? `tool:${turn}:${tool}` : null;
}
const activityText = (value: unknown): string =>
  typeof value === "string"
    ? value
    : Array.isArray(value)
      ? value.map(activityText).join("")
      : value && typeof value === "object"
        ? activityText(obj(value).text ?? obj(value).content ?? obj(value).message ?? "")
        : "";
/** Keep one current card per reasoning stream/tool call, rather than every delta. */
export function appendActivity(blocks: GatewayEvent[], event: GatewayEvent): GatewayEvent[] {
  const key = activityKey(event);
  if (key !== null) {
    const index = blocks.findLastIndex((previous) => activityKey(previous) === key);
    if (index >= 0) {
      const previous = blocks[index];
      const payload = { ...obj(previous.payload), ...obj(event.payload) };
      if (key.startsWith("reasoning:"))
        payload.text = activityText(previous.payload) + activityText(event.payload);
      const next = blocks.slice();
      next[index] = { ...previous, ...event, payload };
      return next;
    }
  }
  return [...blocks, event];
}
export function compactActivity(events: GatewayEvent[]): GatewayEvent[] {
  return events.reduce(appendActivity, [] as GatewayEvent[]);
}
export const emptyChat = (): ChatState => ({
  snapshot: null,
  messages: [],
  liveText: "",
  blocks: [],
  prompts: [],
  pending: [],
  usage: null,
  running: false,
  localMessages: [],
  partialUnavailable: false,
  cursor: null,
});
export function snapshotChat(
  snapshot: Snapshot,
  previous = emptyChat(),
  rebuild = false,
): ChatState {
  const s = obj(snapshot);
  const clearStream =
    rebuild ||
    !s.running ||
    (previous.snapshot !== null &&
      previous.snapshot.execution_generation !== snapshot.execution_generation);
  const rows = Array.isArray(s.display_messages)
    ? s.display_messages
    : Array.isArray(s.messages)
      ? s.messages
      : [];
  const localMessages = (previous.localMessages ?? []).filter(
    (local) =>
      !rows.some((row: unknown) => {
        const r = obj(row);
        return (
          r.submission_id === local.submission_id ||
          (r.row_id != null && local.row_ids?.includes(r.row_id))
        );
      }),
  );
  return {
    ...previous,
    sessionUnavailable: false,
    cursor: null,
    localMessages,
    snapshot,
    messages: Array.isArray(s.display_messages)
      ? s.display_messages
      : Array.isArray(s.messages)
        ? s.messages
        : [],
    pending: Array.isArray(s.pending) ? s.pending : [],
    prompts: Array.isArray(s.prompts) ? s.prompts : [],
    running: !!s.running,
    usage: obj(s.info).usage ?? previous.usage,
    ...(clearStream ? { liveText: "", blocks: [], partialUnavailable: false } : {}),
  };
}
export function reduceEvent(chat: ChatState, event: GatewayEvent): ChatState {
  const p = obj(event.payload),
    type = event.type as string;
  let next = { ...chat };
  if (next.snapshot && typeof event.execution_generation === "number")
    next.snapshot = { ...next.snapshot, execution_generation: event.execution_generation };
  if (next.snapshot && typeof p.execution_generation === "number")
    next.snapshot = { ...next.snapshot, execution_generation: p.execution_generation };
  if (type === "message.start")
    next = { ...next, running: true, liveText: "", blocks: [], partialUnavailable: false };
  else if (type === "message.delta" && typeof p.text === "string") next.liveText += p.text;
  else if (type === "message.complete") {
    next.running = false;
    if (typeof p.text === "string") {
      next.liveText = "";
      next.messages = [
        ...next.messages,
        {
          role: "assistant",
          text: p.text,
          row_id: obj(p.persisted_turn).final_assistant_row_id ?? undefined,
        },
      ];
    }
    if (p.usage) next.usage = p.usage;
    const receipt = obj(p.persisted_turn);
    if (receipt.submission_id || event.admission_id)
      next.localMessages = (next.localMessages ?? []).map((x) =>
        x.submission_id === receipt.submission_id ||
        (event.admission_id && x.admission_id === event.admission_id)
          ? {
              ...x,
              row_ids: [
                ...(receipt.user_row_ids ?? []),
                ...(receipt.user_row_id != null ? [receipt.user_row_id] : []),
              ],
            }
          : x,
      );
  } else if (type === "session.replay_gap")
    next = { ...next, liveText: "", blocks: [], partialUnavailable: true };
  else if (type === "session.info") {
    if (next.snapshot)
      next.snapshot = { ...next.snapshot, info: { ...obj(next.snapshot.info), ...p } };
    if (typeof p.running === "boolean") next.running = p.running;
    if (Array.isArray(p.pending)) next.pending = p.pending;
    if (Array.isArray(p.prompts)) next.prompts = p.prompts;
  } else if (type === "session.usage") next.usage = p;
  else if (type === "approval.request" || type === "clarify.request")
    next.prompts = [
      ...next.prompts.filter((x) => obj(x).prompt_id !== p.prompt_id),
      { ...p, kind: type.split(".")[0] },
    ];
  else if (["approval.settled", "approval.cancelled", "clarify.settled"].includes(type))
    next.prompts = next.prompts.filter((x) => obj(x).prompt_id !== p.prompt_id);
  else if (
    /^(reasoning\.|thinking\.|tool\.|todo\.|status\.|subagent\.|message\.interim|error|notice)/.test(
      type,
    )
  )
    next.blocks = appendActivity(next.blocks, event);
  return next;
}
const time = (v: unknown) =>
  typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) || Number(v) || 0 : 0;
export function mergeSessions(live: SessionRow[], stored: SessionRow[]): SessionRow[] {
  const rows = new Map<string, SessionRow>();
  for (const [source, entries] of [
    ["stored", stored],
    ["live", live],
  ] as const)
    for (const row of entries) {
      const id = String(row.resolved_id || row.session_id || row.id || "");
      if (id) rows.set(id, { ...rows.get(id), ...row, id, is_live: source === "live" });
    }
  return [...rows.values()].sort(
    (a, b) =>
      Number(!!b.is_live) - Number(!!a.is_live) ||
      Number(!!b.pinned) - Number(!!a.pinned) ||
      Number(!!b.running) - Number(!!a.running) ||
      time(b.last_active_at) - time(a.last_active_at),
  );
}
