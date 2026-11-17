export function parseSlash(text: string): { name: string; arg: string } | null {
  if (!/^\/[^\s/]*(?:\s|$)/.test(text)) return null;
  const match = /^(\S+)([\s\S]*)$/.exec(text.replace(/^\/+/, ""));
  return match
    ? { name: match[1].toLowerCase(), arg: match[2].trim() }
    : { name: "", arg: "" };
}
export function modelPayload(
  arg: string,
): { model: string; provider?: string } | null {
  const parts = arg.trim().split(/\s+/).filter(Boolean);
  const model = parts.shift();
  if (!model || model.startsWith("-")) return null;
  let provider: string | undefined;
  while (parts.length) {
    const part = parts.shift();
    if (part === "--session") continue;
    if (
      part === "--provider" &&
      !provider &&
      parts[0] &&
      !parts[0].startsWith("-")
    ) {
      provider = parts.shift();
      continue;
    }
    return null;
  }
  return provider ? { model, provider } : { model };
}
