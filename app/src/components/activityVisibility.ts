import { extractImages } from "./images";

const object = (value: unknown): Record<string, any> =>
  value && typeof value === "object" ? (value as Record<string, any>) : {};

// Structured content can contain reasoning or tool calls alongside normal text.
export function visibleMessageContent(
  value: unknown,
  showActivity: boolean,
): unknown {
  if (showActivity) return value;
  if (Array.isArray(value))
    return value
      .map((part) => visibleMessageContent(part, false))
      .filter((part) => part != null);
  if (value && typeof value === "object") {
    const part = object(value);
    if (
      /^(reasoning|thinking|tool_use|tool_call|tool_result)$/i.test(
        String(part.type ?? ""),
      )
    )
      return null;
    if (part.content != null)
      return { ...part, content: visibleMessageContent(part.content, false) };
  }
  return value;
}

/** Projected tool history can have metadata without a text/content body. */
export function historyMessageContent(value: unknown, showActivity: boolean): unknown {
  const message = object(value);
  const body = message.text ?? message.content;
  if (message.role === "assistant") return visibleMessageContent(body, showActivity);
  if (message.role !== "tool") return body;
  if (!showActivity) return null;
  const details: unknown[] = [];
  if (typeof message.context === "string" && message.context.trim()) details.push(message.context);
  if (message.args != null) details.push(`Arguments:\n${JSON.stringify(message.args, null, 2)}`);
  if (body != null) {
    if (typeof body === "object" && !Array.isArray(body) && !object(body).type && !object(body).text && !object(body).content) {
      details.push(JSON.stringify(body, null, 2));
    } else details.push(body);
  }
  return details.length ? details : "Tool output is not available in saved history.";
}

export function showHistoryMessage(
  value: unknown,
  showActivity: boolean,
): boolean {
  if (showActivity) return true;
  const message = object(value);
  if (message.row_kind === "compaction") return true;
  if (message.role === "tool") return false;
  if (message.role !== "assistant") return true;
  const content = extractImages(
    visibleMessageContent(message.text ?? message.content, false),
  );
  return !!content.text || content.images.length > 0;
}

export function showActivityEvent(
  value: unknown,
  showActivity: boolean,
): boolean {
  if (showActivity) return true;
  const type = String(object(value).type ?? "");
  return !/^(reasoning|thinking|tool|todo|subagent)(\.|$)/i.test(type);
}
