import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImages } from "./images.ts";
test("extracts projected refs and inline image parts without accepting external URLs", () => {
  assert.deepEqual(extractImages('Caption\n@image:"C:\\My Files\\a.png"'), {
    text: "Caption",
    images: ["C:\\My Files\\a.png"],
  });
  assert.deepEqual(
    extractImages([
      { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
    ]),
    { text: "", images: ["data:image/png;base64,YWJj"] },
  );
  assert.deepEqual(
    extractImages([
      { type: "image_url", image_url: { url: "https://example.com/a.png" } },
    ]),
    { text: "", images: [] },
  );
});
