import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionMessage, formatUsage, localMessageStatusLabel } from "./status.ts";

test("accepted and terminal receipts do not claim a message is waiting to send", () => {
  assert.equal(localMessageStatusLabel("accepted"), "Accepted by Hermes");
  assert.equal(localMessageStatusLabel("completed"), "Finished · saved copy");
  assert.equal(localMessageStatusLabel("pending"), "Waiting to send");
});
test("explains incompatible and rejected-token states", () => {
  assert.match(connectionMessage("incompatible"), /shared sessions/);
  assert.match(connectionMessage("auth-failed"), /Connection setup/);
  assert.match(connectionMessage("offline"), /Tailscale/);
});
test("formats nested and direct usage without exposing unknown fields", () => {
  assert.equal(
    formatUsage({
      usage: {
        input: 1000,
        output: 20,
        context_used: 4000,
        context_max: 10000,
        secret: "x",
      },
    }),
    "Input 1,000 · Output 20 · Context 4,000 / 10,000 tokens",
  );
  assert.equal(formatUsage({ prompt: 0, completion: 2 }), "Input 0 · Output 2 tokens");
  assert.equal(formatUsage({ other: "value" }), "");
});

import { chatStatus } from "./status.ts";
const base = {
  connection: "ready",
  submitting: false,
  uploading: false,
  unavailable: false,
  running: false,
  streaming: false,
  promptCount: 0,
  queuedCount: 0,
  unknownCount: 0,
  unsentCount: 0,
  failedCount: 0,
  acceptedCount: 0,
};
test("chat feedback follows actual send, run and queue state", () => {
  assert.equal(chatStatus(base), null);
  assert.equal(chatStatus({ ...base, submitting: true })?.label, "Sending");
  assert.equal(chatStatus({ ...base, unsentCount: 1 })?.detail, "1 message waiting for delivery");
  assert.equal(chatStatus({ ...base, running: true })?.label, "Hermes is working");
  assert.equal(
    chatStatus({ ...base, running: true, streaming: true, queuedCount: 2 })?.detail,
    "2 messages queued",
  );
  assert.equal(chatStatus({ ...base, acceptedCount: 1 })?.label, "Accepted by Hermes");
  assert.equal(chatStatus({ ...base, acceptedCount: 1 })?.spinning, false);
});
test("offline and attention states do not claim work is running", () => {
  assert.deepEqual(
    chatStatus({ ...base, connection: "reconnecting", running: true, unsentCount: 1 }),
    {
      label: "Connecting to Hermes",
      detail: "1 message saved for delivery",
      tone: "warning",
      spinning: false,
    },
  );
  assert.equal(chatStatus({ ...base, connection: "offline" })?.label, "Offline");
  assert.equal(
    chatStatus({ ...base, connection: "offline", promptCount: 1, submitting: true })?.detail,
    "Response needed · reconnect to respond",
  );
  assert.equal(chatStatus({ ...base, promptCount: 1, submitting: true })?.label, "Response needed");
  assert.equal(chatStatus({ ...base, promptCount: 1, uploading: true })?.label, "Response needed");
  assert.equal(
    chatStatus({ ...base, connection: "offline", submitting: true, unsentCount: 1 })?.detail,
    "Preparing request…",
  );
  assert.equal(chatStatus({ ...base, failedCount: 1, running: true })?.label, "Hermes is working");
  assert.equal(chatStatus({ ...base, failedCount: 1 })?.label, "Saved item needs attention");
  assert.equal(chatStatus({ ...base, connection: "auth-failed" })?.label, "Token rejected");
  assert.equal(chatStatus({ ...base, connection: "incompatible" })?.label, "Gateway incompatible");
  assert.equal(chatStatus({ ...base, promptCount: 1, running: true })?.label, "Response needed");
  assert.equal(
    chatStatus({ ...base, unknownCount: 1, queuedCount: 1 })?.label,
    "Delivery status unknown",
  );
  assert.equal(chatStatus({ ...base, unavailable: true, submitting: true }), null);
});

import { showHomeError } from "./status.ts";
test("grace hides connection notices but retains user work feedback", () => {
  assert.equal(
    chatStatus({ ...base, connection: "connecting", connectionGrace: true, running: true }),
    null,
  );
  assert.equal(
    chatStatus({ ...base, connection: "connecting", connectionGrace: true, promptCount: 1 })?.label,
    "Response needed",
  );
  assert.equal(
    chatStatus({ ...base, connection: "offline", connectionGrace: true, unknownCount: 1 })?.label,
    "Delivery status unknown",
  );
  assert.equal(
    chatStatus({ ...base, connection: "offline", connectionGrace: true, failedCount: 1 })?.label,
    "Saved item needs attention",
  );
  assert.equal(
    chatStatus({
      ...base,
      connection: "offline",
      connectionGrace: true,
      submitting: true,
      unsentCount: 1,
    })?.label,
    "Saving message",
  );
  assert.equal(
    chatStatus({ ...base, connection: "offline", connectionGrace: true, unsentCount: 1 })?.label,
    "Message saved",
  );
  assert.equal(showHomeError("Connection unavailable", "offline", true), false);
  assert.equal(showHomeError("Could not save your draft.", "offline", true), true);
  assert.equal(showHomeError("Connection unavailable", "offline", false), true);
});
