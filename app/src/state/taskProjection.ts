/** A bounded record of child handles observed for one origin and parent session. */
export type TaskStatus =
  "running" | "needs_you" | "complete" | "failed" | "interrupted" | "unknown" | "cancel_requested";
export interface TaskProjection {
  id: string;
  goal: string;
  status: TaskStatus;
  childSessionId: string | null;
  summary: string | null;
}
export const MAX_TASKS_PER_SESSION = 100;

type Row = Record<string, unknown>;
const string = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.slice(0, 2000) : null;
const handle = (value: unknown): string | null =>
  typeof value === "string" && value.trim() && value.length <= 512 ? value : null;
const terminal = (status: TaskStatus) =>
  status === "complete" || status === "failed" || status === "interrupted";
function statusOf(value: unknown): TaskStatus {
  switch (value) {
    case "running":
    case "queued":
      return "running";
    case "completed":
      return "complete";
    case "failed":
    case "error":
    case "timeout":
      return "failed";
    case "interrupted":
      return "interrupted";
    default:
      return "unknown";
  }
}
function update(
  previous: TaskProjection | undefined,
  row: Row,
  status: TaskStatus,
): TaskProjection | null {
  const id = handle(row.subagent_id);
  if (!id) return null;
  if (previous && terminal(previous.status)) status = previous.status;
  if (previous?.status === "cancel_requested" && status === "running") status = "cancel_requested";
  return {
    id,
    goal: string(row.goal) ?? previous?.goal ?? "Background task",
    status,
    childSessionId: string(row.child_session_id) ?? previous?.childSessionId ?? null,
    summary: string(row.summary) ?? previous?.summary ?? null,
  };
}
function bounded(tasks: TaskProjection[]) {
  return tasks.slice(-MAX_TASKS_PER_SESSION);
}

/** A successful roster read only: absent formerly live children become unknown. */
export function projectTaskRoster(previous: TaskProjection[], rows: unknown): TaskProjection[] {
  if (!Array.isArray(rows)) return previous;
  const next = previous.map((task) =>
    task.status === "running" || task.status === "cancel_requested"
      ? { ...task, status: "unknown" as const }
      : task,
  );
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Row;
    const id = handle(row.subagent_id);
    if (!id) continue;
    const index = next.findIndex((task) => task.id === id);
    const item = update(
      previous.find((task) => task.id === id),
      row,
      statusOf(row.status),
    );
    if (!item) continue;
    if (index < 0) next.push(item);
    else next[index] = item;
  }
  return bounded(next);
}

/** Project only explicit child events with a stable handle and explicit terminal status. */
export function projectTaskEvent(
  previous: TaskProjection[],
  type: string,
  payload: unknown,
): TaskProjection[] {
  if (
    !["subagent.start", "subagent.progress", "subagent.complete"].includes(type) ||
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  )
    return previous;
  const row = payload as Row;
  const id = handle(row.subagent_id);
  if (!id) return previous;
  const index = previous.findIndex((task) => task.id === id);
  const status = type === "subagent.complete" ? statusOf(row.status) : "running";
  const item = update(index < 0 ? undefined : previous[index], row, status);
  if (!item) return previous;
  const next = previous.slice();
  if (index < 0) next.push(item);
  else next[index] = item;
  return bounded(next);
}

/** An interrupt acknowledgement confirms only that a request was sent. */
export function projectTaskInterrupt(
  previous: TaskProjection[],
  id: string,
  found: boolean,
): TaskProjection[] {
  if (!found) return previous;
  return previous.map((task) =>
    task.id === id && task.status === "running" ? { ...task, status: "cancel_requested" } : task,
  );
}
