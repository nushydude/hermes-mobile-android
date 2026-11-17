import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSlash, modelPayload } from "./slash.ts";
test("parses multiline command without flattening and excludes paths", () => {
  assert.deepEqual(parseSlash("/GoAL first  line\n  second"), {
    name: "goal",
    arg: "first  line\n  second",
  });
  assert.equal(parseSlash("/usr/local"), null);
  assert.equal(parseSlash("hello /goal"), null);
});
test("model flags preserve provider and reject unsupported flags", () => {
  assert.deepEqual(modelPayload("model-a --provider openai --session"), {
    model: "model-a",
    provider: "openai",
  });
  assert.equal(modelPayload("model-a --global"), null);
  assert.equal(modelPayload("model-a --provider"), null);
});
