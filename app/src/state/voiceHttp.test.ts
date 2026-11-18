import { describe, expect, it } from "vitest";
import { limitedText } from "./voiceHttp";
describe("bounded audio response", () => {
  it("enforces declared and streamed byte limits", async () => {
    await expect(
      limitedText(new Response("abcdef", { headers: { "content-length": "6" } }), 5),
    ).rejects.toThrow();
    await expect(limitedText(new Response("abcdef"), 5)).rejects.toThrow();
    expect(await limitedText(new Response("ok"), 5)).toBe("ok");
  });
  it("enforces limit in the React Native text fallback", async () => {
    const result = { headers: new Headers(), body: null, text: async () => "abcdef" } as Response;
    await expect(limitedText(result, 5)).rejects.toThrow();
  });
});
