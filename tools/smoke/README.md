# Gateway protocol smoke probe

Set `HERMES_MOBILE_GATEWAY_URL` to your HTTPS gateway origin, and optionally `HERMES_HOME` to your Hermes home, then run `node tools/smoke/probe.ts`. Node 24 runs this TypeScript directly. These probes contact a live gateway; exercise and handoff modes create or modify their own fixture sessions.
The script reads the provisioned token directly from the Hermes `.env`, connects only
to the configured Tailscale HTTPS endpoint, refuses a gateway without session authority,
and prints shapes and counts rather than stored chat text. It saves the same evidence
under the ignored `runs/` directory. It never records the token or WebSocket ticket.

`node tools/smoke/probe.ts --resume-desktop` additionally finds an idle desktop-created
stored session with at least one message, resumes it, reports the shape and count of its messages, then detaches.
It never submits or edits that session.

`node tools/smoke/probe.ts --exercise` creates its own GUI session, submits a test
prompt, prints every event's type and shape, deliberately disconnects on the first
streamed delta, mints a new ticket, replays and resumes, renames and archives only its
own new session, uploads a generated two-colour PNG and submits it. It performs real agent turns
and leaves a test chat and uploaded image on the gateway. It never automatically
answers approvals. It prints the answer to the new test image (not old chat text) so
the operator can judge whether it understood the image. A manual desktop handoff and approval test remain required for
Milestone 2. An incomplete or failed action exits nonzero.

The exercise saves a generated 64×64 image with a red left half and blue right half
in ignored `runs/`, and records its SHA-256 digest for comparison to the uploaded file.
The response must be a two-key JSON object with left red and right blue; inspect the
printed answer and fixture as well. It reconnects at a live delta and requires replay
and live deltas to reconstruct the final response. Revision conflicts and stale
generations are retried once with fresh fences and the original request ID.

`node tools/smoke/probe.ts --handoff` creates and attaches a fresh titled GUI session,
prints its title and ID, and accepts line-based commands. Open that session on desktop.
`send <text>` submits from the script; `wait <marker>` watches the session for text;
`wait-event <type> [prompt_id]` waits for a new named session event, optionally
matching a specific approval ID; `pending` inspects an approval and prints its ID;
`approve <choice>` responds only with an exact offered choice. Approval choices are
never sent automatically. `quit` detaches. Existing user sessions are not mutated.
Wait checks advance a cursor, and `send` starts a new checkpoint before submission,
so previously observed events cannot satisfy a later check.

Run offline checks with `node --test tools/smoke/core.test.mjs`.

Read-only model selection check: `npx tsc -p tools/smoke/tsconfig.protocol-probe.json`, then
`node tools/smoke/model-options-probe.mjs`. Compares global configured and unfiltered model catalogs,
checks a stored Desktop session's configured catalog without resuming it, and verifies the runtime's
create-provider support. Prints model/provider names and counts only, never credentials or raw
transport errors. No sessions are created or modified. Evidence is saved under ignored `.artifacts/`.


## Later focused probes

First compile the protocol runtime with `npx tsc -p tools/smoke/tsconfig.protocol-probe.json`.
`node tools/smoke/reasoning-picker.mjs` then creates/resumes an owned idle GUI fixture, mutates the
eight Hermes reasoning policies, tests null reset/invalid rejection, records requested/effective
levels and archives its fixtures. It makes no prompt/LLM turn and does not change global defaults.
It is a mutating fixture probe, not read-only. The provider can clamp further; a successful policy
mutation does not prove native provider support.

The model-options probe also applies the mobile OpenAI plus saved custom/local provider policy.
The gateway's explicit_only flag alone includes borrowed CLI logins on this installation. Neither
that flag nor a reasoning boolean supplies a complete per-model effort enum. See the later
corrections in [PROTOCOL_CONTRACT.md](../../PROTOCOL_CONTRACT.md).

Audio and latency probes perform real gateway/provider work with bounded synthetic fixtures.
They are not part of offline `test:host` and do not establish physical microphone/playback quality.
See [verification and acceptance](../../docs/verification.md) for the complete check matrix.
