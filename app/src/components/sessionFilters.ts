export type SessionFilter = "all" | "running" | "attention" | "unread" | "drafts";
export type SessionFlags = { running: boolean; attention: boolean; unread: boolean; draft: string };
type FilterRow = {
  id: string;
  title?: string | null;
  preview?: string | null;
  cwd?: string | null;
  running?: boolean;
  needs_attention?: unknown;
  unread?: unknown;
};
type FilterChat = {
  draftAttachments?: readonly unknown[];
  prompts?: readonly unknown[];
  pending?: readonly unknown[];
  localMessages?: readonly { status?: string }[];
};
type RecoveryItem = { session_id: string; error?: unknown };

/** A primitive snapshot avoids rerendering the session list for every streamed token. */
export function chatAttentionKey(chats: Readonly<Record<string, FilterChat | undefined>>): string {
  return JSON.stringify(
    Object.keys(chats)
      .filter((id) => {
        const chat = chats[id];
        return (
          !!chat?.prompts?.length ||
          !!chat?.pending?.some(
            (value) =>
              !!value &&
              typeof value === "object" &&
              (value as { status?: unknown }).status === "unknown",
          ) ||
          !!chat?.localMessages?.some((message) => message.status === "failed")
        );
      })
      .sort(),
  );
}

/** Image-only drafts need their own stable primitive subscription. */
export function chatDraftKey(chats: Readonly<Record<string, FilterChat | undefined>>): string {
  return JSON.stringify(
    Object.entries(chats)
      .filter(([, chat]) => !!chat?.draftAttachments?.length)
      .map(([id, chat]) => [id, chat!.draftAttachments!.length])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

export function sessionFlags<T extends FilterRow>(
  rows: readonly T[],
  drafts: Readonly<Record<string, string>>,
  attentionKey: string,
  outbox: readonly RecoveryItem[],
  edits: readonly RecoveryItem[],
  connected: boolean,
  imageDraftKey = "[]",
) {
  const images = new Map<string, number>(JSON.parse(imageDraftKey));
  const attention = new Set<string>(JSON.parse(attentionKey) as string[]);
  for (const item of [...outbox, ...edits]) if (item.error) attention.add(item.session_id);
  const flags: Record<string, SessionFlags> = Object.create(null);
  const counts: Record<SessionFilter, number> = {
    all: rows.length,
    running: 0,
    attention: 0,
    unread: 0,
    drafts: 0,
  };
  for (const row of rows) {
    const storedDraft = Object.prototype.hasOwnProperty.call(drafts, row.id) ? drafts[row.id] : "";
    const caption = typeof storedDraft === "string" ? storedDraft.trim() : "";
    const count = images.get(row.id) ?? 0;
    const draft = caption || (count > 0 ? `${count} ${count === 1 ? "image" : "images"}` : "");
    const value = {
      running: connected && !!row.running,
      attention: !!row.needs_attention || attention.has(row.id),
      unread: !!row.unread,
      draft,
    };
    flags[row.id] = value;
    if (value.running) counts.running++;
    if (value.attention) counts.attention++;
    if (value.unread) counts.unread++;
    if (draft) counts.drafts++;
  }
  return { flags, counts };
}

export function filterSessions<T extends FilterRow>(
  rows: readonly T[],
  flags: Readonly<Record<string, SessionFlags>>,
  filter: SessionFilter,
  query: string,
): T[] {
  const search = query.trim().toLocaleLowerCase();
  return rows.filter((row) => {
    const flag = flags[row.id];
    if (!flag) return false;
    const included = filter === "all" || (filter === "drafts" ? !!flag.draft : flag[filter]);
    return (
      included &&
      (!search ||
        `${row.title ?? ""} ${row.preview ?? ""} ${row.cwd ?? ""} ${flag.draft}`
          .toLocaleLowerCase()
          .includes(search))
    );
  });
}
