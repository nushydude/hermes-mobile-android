import { expect, it } from "vitest";
import { addRoomImages, visibleRoomImages } from "./roomImages";
it("reconciles selection against durable draft and rejects a late prior-room picker", () => {
  const a = {},
    b = {};
  const image = (path: string) => ({ path, uri: path, mime: "image/jpeg" });
  let selection = { owner: a, images: [image("B")] };
  expect(visibleRoomImages(selection, a, [])).toEqual([]);
  expect(visibleRoomImages(selection, a, [image("B")])).toHaveLength(1);
  selection = { owner: b, images: [] };
  expect(addRoomImages(selection, a, [image("late")], false)).toBe(selection);
  expect(visibleRoomImages(selection, b, [image("late")])).toEqual([]);
});
