export function extractImages(value: unknown): {
  text: string;
  images: string[];
} {
  const images: string[] = [];
  const parts: string[] = [];
  function addImage(value: unknown) {
    if (typeof value !== "string") return;
    if (
      /^data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i.test(value) ||
      /^(?:[a-z]:[\\/]|\/)/i.test(value)
    )
      images.push(value);
  }
  function visit(part: unknown) {
    if (typeof part === "string") {
      const withoutData = part.replace(
        /data:image\/(?:png|jpeg|gif|webp);base64,[a-z0-9+/=]+/gi,
        (match) => {
          addImage(match);
          return "";
        },
      );
      parts.push(
        withoutData.replace(
          /^@image:(?:`([^`\n]+)`|"([^"\n]+)"|'([^'\n]+)'|(\S+))\s*$/gm,
          (match, a, b, c, d) => {
            const path = a || b || c || d;
            const count = images.length;
            addImage(path);
            return images.length > count ? "" : match;
          },
        ),
      );
    } else if (Array.isArray(part)) part.forEach(visit);
    else if (part && typeof part === "object") {
      const item = part as Record<string, any>;
      if (["image_url", "input_image", "image"].includes(item.type))
        addImage(
          typeof item.image_url === "string"
            ? item.image_url
            : (item.image_url?.url ?? item.path),
        );
      else if (typeof item.text === "string") visit(item.text);
      else if (item.content != null) visit(item.content);
    }
  }
  visit(value);
  return { text: parts.join("\n").trim(), images };
}
