import { describe, it, expect } from "vitest";
import { favouritesFirst, modelFavouriteKey, parseModelFavourites } from "./modelFavouriteCore";
describe("model favourites", () => {
  it("preserves provider identity and the original catalogue order within groups", () => {
    const a = { provider: "one", model: "same" },
      b = { provider: "two", model: "same" },
      c = { provider: "one", model: "other" };
    expect(favouritesFirst([a, b, c], [modelFavouriteKey(b)])).toEqual([b, a, c]);
    expect(favouritesFirst([a, b, c], [])).toEqual([a, b, c]);
  });
  it("fails closed on malformed storage and bounds valid favourites", () => {
    expect(parseModelFavourites("bad")).toEqual([]);
    expect(
      parseModelFavourites(JSON.stringify(["[]", "null", 7, '["","m"]', '["p","m"]', '["p","m"]'])),
    ).toEqual(['["p","m"]']);
    expect(
      parseModelFavourites(
        JSON.stringify(
          Array.from({ length: 120 }, (_, i) =>
            modelFavouriteKey({ provider: "p", model: String(i) }),
          ),
        ),
      ),
    ).toHaveLength(100);
  });
});
