import { test } from "node:test";
import assert from "node:assert/strict";
import {
  modelChoices,
  mobileModelChoices,
  sameModel,
  filterModels,
  recentWorkspaces,
  filterWorkspaces,
  workspaceName,
} from "./selections.ts";
test("retains provider identity, disables unavailable models, deduplicates and searches", () => {
  const options = modelChoices({
    providers: [
      {
        slug: "a",
        name: "First",
        models: ["shared", "gone", "shared"],
        unavailable_models: ["gone"],
      },
      { slug: "b", name: "Second", models: ["shared", "other"] },
      { slug: "", models: ["bad"] },
    ],
  });
  assert.deepEqual(options, [
    { provider: "a", providerName: "First", model: "shared", disabled: false },
    {
      provider: "a",
      providerName: "First",
      model: "gone",
      disabled: true,
      reason: "Model unavailable",
    },
    { provider: "b", providerName: "Second", model: "shared", disabled: false },
    { provider: "b", providerName: "Second", model: "other", disabled: false },
  ]);
  assert.equal(sameModel(options[0], options[2]), false);
  assert.deepEqual(filterModels(options, "second"), options.slice(2));
  assert.deepEqual(filterModels(options, "shared"), [options[0], options[2]]);
  assert.equal(
    modelChoices({ providers: [{ slug: "private", authenticated: false, models: ["x"] }] })[0]
      .disabled,
    true,
  );
  assert.deepEqual(modelChoices({ providers: [{ name: "Invalid", models: ["a"] }, null] }), []);
});
test("returns every unique recent cwd in original order and filters without truncation", () => {
  const paths = recentWorkspaces([
    { cwd: "A" },
    { cwd: "B" },
    { cwd: "A" },
    { cwd: "" },
    { cwd: "C" },
    { cwd: "D" },
  ]);
  assert.deepEqual(paths, ["A", "B", "C", "D"]);
  assert.deepEqual(filterWorkspaces(paths, "d"), ["D"]);
});

test("mobile catalog excludes authenticated ambient Claude while retaining OpenAI and saved local models", () => {
  const providers = [
    {
      slug: "anthropic",
      source: "hermes",
      authenticated: true,
      is_user_defined: false,
      is_current: true,
      models: ["claude-example"],
    },
    { slug: "openai-codex", source: "hermes", authenticated: true, models: ["gpt-example"] },
    { slug: "openai", models: ["api-example"] },
    {
      slug: "ollama-launch",
      source: "user-config",
      is_user_defined: true,
      models: ["local-example"],
    },
    { slug: "llamacpp", source: "local-runtime", models: ["staged-example"] },
    {
      slug: "saved-endpoint",
      is_user_defined: true,
      models: ["saved-example"],
      unavailable_models: ["saved-example"],
    },
    { slug: "nous", authenticated: true, models: ["ambient-example"] },
  ];
  const choices = mobileModelChoices({ providers });
  assert.deepEqual(
    choices.map((choice) => choice.provider),
    ["openai-codex", "openai", "ollama-launch", "llamacpp", "saved-endpoint"],
  );
  assert.equal(choices.at(-1).disabled, true);
  assert.deepEqual(mobileModelChoices({ providers: [null, {}, "bad"] }), []);
  assert.deepEqual(mobileModelChoices(null), []);
});

test("workspace labels use actual Windows and POSIX basenames", () => {
  assert.equal(workspaceName("C:\\Users\\Ada\\Project\\"), "Project");
  assert.equal(workspaceName("/srv/projects/app/"), "app");
  assert.equal(workspaceName(null), "");
});
