import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: true, linkify: true });
/** Convert only assistant output for speech. Canonical chat text is never changed. */
export function speechText(text: string): string {
  const tokens = markdown.parse(text, {});
  const words: string[] = [];
  const inline = (children: typeof tokens) => {
    for (const token of children) {
      if (token.type === "image") words.push("Image in chat.");
      else if (token.type === "text" || token.type === "code_inline")
        words.push(token.content.replace(/(?:https?:\/\/|www\.)\S+/gi, ""));
      else if (token.type === "softbreak" || token.type === "hardbreak") words.push(" ");
    }
  };
  for (const token of tokens) {
    if (token.type === "fence" || token.type === "code_block") words.push(" The code is in chat. ");
    else if (token.type === "inline" && token.children) {
      inline(token.children);
      words.push(" ");
    } else if (token.type.endsWith("_close")) words.push(" ");
  }
  return words.join("").replace(/\s+/gu, " ").trim();
}

/** Preserve all spoken characters while bounding each synthesis request. */
export function speechParts(text: string, limit = 2000): string[] {
  if (!Number.isInteger(limit) || limit < 2 || limit > 4000)
    throw new RangeError("Speech part limit must be an integer from 2 to 4000");
  const parts: string[] = [];
  let rest = text.trim();
  while (rest.length > (parts.length === 0 ? Math.min(limit, 320) : limit)) {
    let end = parts.length === 0 ? Math.min(limit, 320) : limit;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1]) && /[\uDC00-\uDFFF]/.test(rest[end])) end--;
    const window = rest.slice(0, end);
    const sentence = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("! "),
      window.lastIndexOf("? "),
    );
    const whitespace = window.lastIndexOf(" ");
    if (sentence >= end / 2) end = sentence + 1;
    else if (whitespace >= end / 2) end = whitespace;
    parts.push(rest.slice(0, end).trim());
    rest = rest.slice(end).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
