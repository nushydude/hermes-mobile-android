/** Preserve the current draft while quoting the exact selected range as Markdown. */
export function appendQuote(
  draft: string,
  content: string,
  start: number,
  end: number,
): string | null {
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  let from = Math.max(0, Math.min(content.length, Math.floor(Math.min(start, end))));
  let to = Math.max(0, Math.min(content.length, Math.floor(Math.max(start, end))));
  if (from === to) return null;
  // Android selection offsets are UTF-16. Never split an emoji or other surrogate pair.
  if (
    from > 0 &&
    /[\uDC00-\uDFFF]/.test(content[from]) &&
    /[\uD800-\uDBFF]/.test(content[from - 1])
  )
    from--;
  if (to > 0 && /[\uD800-\uDBFF]/.test(content[to - 1]) && /[\uDC00-\uDFFF]/.test(content[to]))
    to++;
  const selected = content.slice(from, to).replace(/\r\n?/g, "\n");
  if (!selected.trim()) return null;
  const quote = selected
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  const separator = !draft
    ? ""
    : draft.endsWith("\n\n")
      ? ""
      : draft.endsWith("\n")
        ? "\n"
        : "\n\n";
  return `${draft}${separator}${quote}\n\n`;
}

function pattern(query: string): RegExp | null {
  const value = query.trim();
  if (!value) return null;
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
}

/** Search visible loaded rows only, returning their stable keys and current list positions. */
export function findLoadedMessages(
  rows: readonly { key: string; text: string; index: number }[],
  query: string,
) {
  const re = pattern(query);
  if (!re) return [];
  return rows
    .filter((row) => {
      re.lastIndex = 0;
      return re.test(row.text);
    })
    .map(({ key, index }) => ({ key, index }));
}

export function nextMatchKey(
  matches: readonly { key: string }[],
  current: string | null,
  direction: 1 | -1,
): string | null {
  if (!matches.length) return null;
  const index = matches.findIndex((match) => match.key === current);
  const next =
    index < 0
      ? direction === 1
        ? 0
        : matches.length - 1
      : (index + direction + matches.length) % matches.length;
  return matches[next].key;
}

/** A retry may move only to a measured frame and must stop when no progress is made. */
export function measuredSearchHop(
  state: { attempts: number; lastMeasured: number; stagnant: number },
  info: { index: number; highestMeasuredFrameIndex: number },
) {
  const attempts = state.attempts + 1;
  const measured = info.highestMeasuredFrameIndex;
  const stagnant = measured <= state.lastMeasured ? state.stagnant + 1 : 0;
  if (
    attempts > 12 ||
    !Number.isInteger(measured) ||
    measured < 0 ||
    measured >= info.index ||
    stagnant > 2
  )
    return null;
  return { attempts, lastMeasured: measured, stagnant, frame: measured };
}

/** Split text nodes without changing their content, with a bounded number of highlighted spans. */
export function highlightParts(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const re = pattern(query);
  if (!re) return [{ text, match: false }];
  const parts: Array<{ text: string; match: boolean }> = [];
  let last = 0,
    match: RegExpExecArray | null;
  while ((match = re.exec(text)) && parts.length < 199) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), match: false });
    parts.push({ text: match[0], match: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), match: false });
  return parts.length ? parts : [{ text, match: false }];
}
