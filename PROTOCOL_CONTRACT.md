> Historical observations from one installation. Hostnames and session titles have been generalized; validate behavior against your own gateway version.

# Observed Hermes gateway protocol

> Observations are dated; later corrections supersede earlier interpretations. In particular, the 17 November mobile provider-policy and reasoning sections refine the initial configured-model catalog claim. Current implementation/acceptance: [status](docs/STATUS.md).

## Configured model catalog follow-up (16 November 2026)

Read-only `tools/smoke/model-options-probe.mjs` verified `model.options {explicit_only:true}`
globally and with `session_id` over the Tailscale endpoint. This matches Desktop's configured-provider
picker; omitting the flag returned an additional provider with 68 models on this machine. The
configured catalog returned three providers with 18, 15 and four model IDs respectively. The global
default model differed from the existing Desktop session's model, so creation uses the global
catalog and switching uses the session-scoped catalog. Preserve each row's provider slug alongside
its model ID. `runtime.describe.session_create.parameters` includes `provider`; it can be supplied
with `model` when creating a session. This check created or mutated no sessions. Recent workspace
choices come from session inventory `cwd`, as PLAN specifies; they are not a directory enumeration.

**Gate 2 passed:** the automated exercise, bidirectional desktop handoff, and both approval response
paths were verified against the real gateway. No app scaffolding had been created at that gate.
The owner later authorized Milestone 3; its setup/build results are in `PC_SETUP.md`.
Observations below came from this PC's running gateway through
`https://desktop.example-tailnet.ts.net:9120`, not loopback. Credentials are omitted.

## Environment and evidence

- Date: 15 November 2026, Australia/Sydney.
- Read-only checkout version: `v0.23.1+canary.20261113T064447Z-2-gea1d78596e7`.
- Milestone 1 REST checks passed; owner confirmed desktop and Telegram still work and supplied a
  phone screenshot showing the token gate over Tailscale HTTPS.
- `node tools/smoke/probe.ts` exited 0 on the real gateway. Shape-only evidence is stored locally
  under `tools/smoke/runs/`; no deployment token or socket ticket is retained.
- `node tools/smoke/probe.ts --resume-desktop` exited 0. The meaningful run resumed an idle
  `source:"desktop"` session with 62 transcript messages and 56 display-projected rows, then
  detached without an end reason. An earlier selection resumed an empty GUI row; that earlier
  result is not counted as evidence of old-history recovery.
- `node tools/smoke/probe.ts --exercise` exited **1**. Failed-run evidence:
  `tools/smoke/runs/probe-1794737120877.json`, started `2026-11-15T10:05:17.479Z`.
- Adoption happened before the probe: `hermes sessions adopt` adopted 142 default-profile chats
  (135 desktop, 4 oneshot, 3 tui). Necessity of adoption cannot be established retrospectively.

## Verified connect and inventory

1. Bearer-authenticated `POST /api/auth/ws-ticket` returned HTTP 200:
   `{ "ticket": "<omitted>", "ttl_seconds": 30 }`.
2. Native Node WebSocket to `/api/ws`, offering `hermes-gateway-v1` plus the single-use ticket
   subprotocol, connected through Tailscale Serve. Selected protocol: `hermes-gateway-v1`.
   No `Origin` or `X-Hermes-Gateway-Ticket` header was supplied.
3. The first application frame had this observed envelope (skin, change-events field and random
   epoch omitted here; authority and heartbeat values were explicitly recorded):

   ```json
   {"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{"heartbeat":true,"replay_epoch":"<epoch>","session_authority":true}}}
   ```

4. `client.capabilities {"server_requests":true}` succeeded. Result keys:
   `server_requests` (16 entries), `declines_not_shown`, `canonical_clarify_batch`.
5. `runtime.describe {}` succeeded. Result includes `instance_id`, `profile_id`, `authority_epoch`,
   `capabilities` (10 entries), `session_create`, and `skin`. Advertised sources:
   `acp`, `cli`, `gui`, `oneshot`, `tool`, `tui`. Advertised create parameters include `client`,
   `request_id`, `source`, `cwd`, `model`, `title`; runtime advertised 28 parameters in total.
6. `session.list {"scope":"live","limit":100,"picker":true}` returned 10 rows.
7. The same call with `scope:"stored"` returned 100 rows (the requested limit). Row fields include
   IDs, title, source, started_at, message_count, model, running, preview, cwd, workspace,
   git_branch, last_active_at, pinned, last_reply. Stored rows also carry `resolved_id`.

## Live exercise: observed success followed by failure

- Created a new session with `source:"gui"` and `client:{name:"hermes-mobile",version:"smoke-1"}`.
  Resumed it; initial `revision=0`, `last_sequence=0`.
- Submitted a short greeting/ten-colours prompt with a UUID submission ID. Receipt status was
  `queued`; the turn proceeded to `message.start` and streamed `message.delta` frames.
- Closed the client socket after detecting a delta; minted a fresh ticket and reconnected.
  `session.events.since` from sequence 0 returned 11 events with `snapshot_required=false`.
  The subsequent resume returned `running=true`. A later `message.complete` had
  `payload.status="complete"`.
- Observed event types: `sessions.changed`, `session.info`, `message.start`, `agent.step`,
  `thinking.delta`, `platforms.changed`, `message.delta`, `session.usage`, `message.complete`.
  Delta frames carried `turn_id`, `segment`, `offset`, and text. Scoped stream frames carried
  authority epoch, execution generation, admission ID, replay epoch and sequence.
- The next intended call was rename via `session.mutate`, using the revision from the mid-turn
  resume. The run failed with **`RPC failed (code 4001)`** before recording a rename receipt.
  No archive, upload, or image prompt was reached.
- The original RPC error handler discarded the method, server message and error data. Therefore
  the exact server reason is **unknown**; stale revision is a hypothesis, not an observed diagnosis.
  The saved script now includes method, sanitized server message and error-data shape for a future
  investigation. That diagnostic change has not been run against the gateway.
- No further gateway test was run after the failure, as instructed. The fresh test session remains
  unarchived; no existing chat was submitted to or mutated by the script.

### Authorized diagnosis follow-up

The owner subsequently authorized diagnosis, script repair and a Milestone 2 rerun. A diagnostic
rerun reproduced the failure and retained this sanitized result:

```text
RPC session.mutate failed (code 4001): revision_conflict;
data shape: {"reason":"string","revision":"number","execution_generation":"number"}
```

This confirms the failure was a stale revision in rename, not an unrecognized RPC parameter.
The script used the mid-turn resume's revision after waiting for completion, without applying the
intervening `session.info` revision updates or PLAN.md's one-retry conflict handling. Repair is in
complete. This was a smoke-client bug; no Hermes checkout change or gateway restart was needed.

## Repaired exercise and handoff results

Final automated run: `node tools/smoke/probe.ts --exercise`, exit **0**, evidence
`tools/smoke/runs/probe-1794738019302.json`, started `2026-11-15T10:20:01.570Z`.

- New GUI session created and resumed. A UUID submission was durably queued, then ran.
- The socket closed synchronously on a nonempty delta at sequence 7 (one character), before
  completion. Null-text boundaries do not trigger the disconnect.
- Fresh ticket and WSS reconnect succeeded. Replay from sequence 0 returned 10 events with
  `snapshot_required=false`. Resume returned `running=true`.
- Replay/live deltas reconstructed **all 1,200 UTF-16 code units**, exactly equal to the completed
  response. The check rejects gaps and conflicting overlaps and deduplicates repeated sequences.
- Rename succeeded at revision 2; archive succeeded at revision 3. The unique test title was
  `Hermes Mobile smoke 5f02e012-db1b-4c31-8fbd-fb2a639b1bbf`.
- Image upload returned HTTP 200, and attachment submission was accepted. The model completed with
  `{"left":"red","right":"blue"}`, matching the generated 64×64 fixture.
- Original and uploaded image bytes were compared on this PC: identical SHA256
  `48800118460aab252e972e95577b3627c13537c4f198dfeb38192d397dad3b46`.
- The script detached without an end reason. It only mutated its own new session.

Actual desktop handoff was tested using `--handoff` and Windows Computer Use, not a simulated second
socket. Session title: `example handoff session`.
The script detached cleanly and saved `tools/smoke/runs/probe-1794738161374.json`.

- Submitted `Without using tools, reply exactly SCRIPT_TO_DESKTOP_2114.` from the script.
  Opened the same session in Hermes Desktop; both that user prompt and the exact assistant marker
  were visible in the real UI.
- Entered and sent `Without using tools, reply exactly DESKTOP_TO_SCRIPT_2116.` in that desktop
  session. The script observed `DESKTOP_TO_SCRIPT_2116` and generation-2 completion, without a
  reconnect or refresh. This marker had not been submitted by the script.
- The owner’s existing draft and other chats were not edited by the test.

### Additional failures exposed and fixed

- A null-text boundary initially caused a false failure before disconnect. A shared nonempty-text
  predicate now drives both triggering and observation; regression coverage includes null/empty.
- Reusing the literal title `Hermes Mobile smoke test` on another session returned **-32603 internal
  error**. The gateway's local traceback confirmed a duplicate-title `ValueError`, even though the
  conflicting earlier smoke session was archived. Unique UUID titles make the script rerunnable.
  This is also a gateway error-reporting limitation: duplicate title is not a useful domain error.
- One image response reversed the colors. That run's old mentions-only assertion incorrectly
  returned success; that image observation is **failed**, despite the saved exit status. Upload
  bytes were not flipped. The final assertion accepts only an exact two-key JSON observation,
  rejecting reversed values, negated prose and extra fields. The subsequent strict test passed
  without disclosing expected colors in the prompt or changing the model.
- The handoff helper originally searched all past events. It now uses a cursor and an optional
  prompt-ID match, so a past approval settlement cannot satisfy a later desktop-response check.

## Approval tests

The existing profile is in **Smart** approval mode. A real terminal call using
`Remove-Item -LiteralPath <workspace>/tools/smoke/runs/approval-fixture -Recurse -Force -WhatIf`
ran without raising `approval.request`; the harmless fixture remains intact. Therefore that attempt
does **not** verify manual approval delivery or responses. No approval was fabricated or bypassed.

The owner explicitly approved temporary Manual mode. Before changing it, backed up config to
`%LOCALAPPDATA%\hermes\config.yaml.pre-mobile-20261115215410.bak`.
Ran `hermes config set approvals.mode manual`, without restarting the gateway.

1. Script response, evidence `tools/smoke/runs/probe-1794740213313.json`:
   - Session `local-129bd2da7ea9c2416c297d0a3f990960168fccbb669d735845fa1977886a447c`.
   - `approval.request`, sequence 16, generation 1, offered `once`, `deny`, `session`, `always`.
   - Prompt ID `6e0a2f3ca48a42d4a05e5c5bb3af31ce`; command targeted only the first fixture with
     `-WhatIf`.
   - Main sent `approval.respond` through the script with `choice:"deny"`; the RPC succeeded and
     `approval.settled` arrived at sequence 17 on the same session/generation/admission.
   - The real desktop displayed "Denied; the command did not run. I stopped without trying an
     alternative." The fixture remains intact.
   - A subsequent manual `wait-event` command used a mistyped 33-character prompt ID (a digit was
     duplicated while reading wrapped terminal output), so that command timed out and this helper
     invocation exited 1. This operator error is not a missing settlement: the saved event stream
     records the successful response and settlement before the timeout.
2. Desktop response, evidence `tools/smoke/runs/probe-1794740293670.json` (exit 0):
   - Session `local-d2ef40001e622d526bd1c0933cca6a1d183f2b5a7b717b893ccff4b2f46beec9`, title
     `example handoff session`.
   - Submitted a separate `-WhatIf` dry run against `approval-fixture-desktop`.
   - Observed `approval.request` at sequence 17 and `approval.settled` at sequence 18, generation 1,
     admission `0b79bd0ab5284648a671dfaf7a8b5ee5`.
   - The script sent **no approval response** in this session. The owner explicitly confirmed
     answering that approval in Hermes Desktop. `pending` subsequently reported no open approval.
   - No other request was present in that session. The fixture remains intact.

Restored `approvals.mode=smart` and verified the config value. Both helper sockets have closed.
No restart, messaging-provider change, profile migration or Serve change occurred.

### Limitations of the initial failing run

Successful replay and a running resume established that the turn survived that reconnect. That
initial script did not prove that partial text was fully reconstructed without omissions or duplicates.
Independent review found two timing limitations: a delta and completion already buffered together
could mislabel the disconnect as mid-turn; a completion arriving during the resume RPC could cause
a false failure. Those client issues were subsequently repaired and the successful rerun above
includes exact reconstruction and the corresponding offline regression checks.

## Open questions from PLAN.md

| Question | Current observed answer |
| --- | --- |
| 1. Bearer ws-ticket on this listener? | Yes: HTTP 200 and successful canonical dial. No fallback needed or tested. |
| 2. Stored history and old-session continuation? | Stored inventory visible after adoption; an old desktop transcript resumed (62 messages). New submission into that old chat was not tested. Adoption necessity unknown. |
| 3. Recover partial output when joining mid-turn? | Yes in the bounded test: replay plus live deltas exactly reconstructed the 1,200-character final response after a running resume. Replay remains bounded by the ring; clients must handle snapshot_required. |
| 4. Automatic title events? | Untitled test sessions produced a prompt-derived title in `session.info`, with `sessions.changed` broadcasts also observed. Rename produced `session.updated` with the new title. No claim about all later background AI-generated title paths. |
| 5. Serve WebSocket upgrade and accepted Host? | Yes, verified by successful WSS connection and RPC responses. |
| 6. Restarted gateway loads `.env` token? | Yes for the restarted gateway process. Windows restart used direct spawn; scheduled-task logon startup was not independently tested. |
| 7. APIs without built Webapp bundle? | Status, bearer auth, ticket, canonical socket, inventory, resume, create, submit, streaming, replay, rename/archive and image upload/submission all worked. No bundle build required. |
| 8. GUI vs TUI desktop bridge frequency? | No desktop bridge request observed in the successful GUI text/image and handoff turns. No broad TUI/tool-heavy comparison; retain gui, decline unsupported bridges and monitor after first real use. |

## Differences and limits

- `hermes webapp --status` reports the UI bundle is missing even while the authenticated listener
  and tested API routes work. No bundle was built and no Hermes source was modified.
- `gateway.ready` and subsequent notifications use the outer JSON-RPC method `event`, with the
  event name in `params.type`. Treating event names as outer methods would miss them.
- No protocol contradiction has been established by the initial successful read-only probe.
  Handshake success alone does not prove shared live desktop sessions.
- Broadcasts such as the observed `sessions.changed` frame need not carry the scoped stream's
  sequence/epoch/generation envelope. PLAN.md's "every event" claim is too broad.
- Source-only follow-up, **not live-tested**: `CanonicalCorrectionAck` documents that a rejected
  steer is safe to resubmit only when `delivered:false` is explicit. A plain `rejected` can follow
  delivery with an ACK timeout. Do not implement unconditional fallback submission from PLAN.md.

## Remaining required checks

Milestone 2's required live checks are covered by the evidence above. The proof is an attended
multi-phase smoke run, including the real desktop UI and the owner's approval response, rather than
a single unattended command. Stop at Gate 2 before starting Milestone 3.

Remaining limits: adoption happened before the history check, so its necessity was not tested;
Windows logon through the scheduled task was not separately retested; desktop-bridge observations
are a small sample rather than a frequency study. These are explicit limits, not claims that those
untested variants passed. The deployed gateway process, adopted history, shared live sessions and
required API paths were exercised successfully.

## Review record

- Implementation: one reused `loop_implementor` agent. Main executed live acceptance and desktop UI
  checks. No child executed gateway calls.
- Independent review: reused `loop_reviewer` (zero tool calls). The initial timing/replay findings,
  historical handoff-event matching finding, and image-negation finding were repaired. The final
  supplied delta received a clear verdict; this is source review, not independent live execution.
- Final source candidate SHA256:
  - `probe.ts`: `d3efd4633773d3145d0a442e76c32a87509fd18c4f87f87bb2d9de7cce5c308c`
  - `core.mjs`: `d6d138383db3aa1f886cdf4985194dac4e0e93508c2b06ef47ff2cc51c2fb155`
  - `core.test.mjs`: `4d1635cf08e53cec6ce0b20e0d86cdf7759cb4a87ee6431aa861b4dceb1f3028`
- `node --test tools/smoke/core.test.mjs`: eight tests passed. Covers bounded mutation retries,
  generation refresh, reconnect timing, replay gaps/overlaps/UTF-16 offsets, session tracking,
  handoff event cursor/prompt identity, and strict image observations.
- Token usage telemetry was unavailable. There is no claimed team token total.

## Milestone 4 integration observations

The app manager was exercised from Node against the real Tailscale endpoint, with native
SQLite/SecureStore/lifecycle adapters replaced by in-memory test adapters. It authenticated,
listed sessions, created its own GUI session, submitted through its durable outbox, loaded
authoritative user/assistant transcript rows, observed another viewer's pending prompt and reply
without refreshing, and archived its test session. This is not Android or actual Desktop UI proof.

The app image methods uploaded a PNG, then read the same bytes through
`GET /api/fs/read-data-url?path=...&session_id=...`. The observed response's image field is
`dataUrl` (camel case); upload still returns `path` and `mime_type`.

Additional source verification, **not a live queued-edit or model-confirmation test**:

- `gateway/session_queued_controls.py` accepts an exact `prompt.replace_queued` retry with the
  same submission ID. The app therefore persists that ID before requesting a queued replacement.
- `gateway/session_mutation_model.py` returns the model confirmation token in `confirm`, with
  `status: "confirmation_required"`. It is passed back only after an explicit UI confirmation.
- Shared slash parsing preserves interior whitespace/newlines and excludes `/usr/local`-style
  paths. `/model`, `/branch` and `/compress` use canonical mutations when applicable.

No new running-gateway contradiction was found during these checks. Phone-side approvals,
camera/gallery, reconnect and real Desktop handoff remain Gate 3 checks.

History limit found while implementing search: `gateway/session_controls.py` accepts at most
200 rows per `session.list` call and exposes no pagination cursor. A `title` lookup is exact
identity lookup and cannot be combined with `scope` or `picker`. The app requests 200, warns
when that limit is reached, and offers exact-title lookup for older sessions. Local text search
therefore covers the loaded inventory, not unlimited gateway history. This refines PLAN.md's
unqualified search requirement without changing the gateway or inventing RPC parameters.

## Adversarial recovery verification — 16 November 2026

The live `recovery-live.test.ts` test used only its own disposable GUI sessions. After deleting
one session while retaining its client subscription, `session.events.since` returned **4001**
with structured `data.reason: "not_found"`. An initial repair that expected only 4004 failed
this check. Recovery now isolates this specific refusal for 4001 or 4004, removes that retained
subscription, and continues recovering other sessions. Unrelated 4001 refusals still fail the
connection attempt. The repaired client reconnected to `ready` and submitted successfully to
the healthy session. Its remaining own test sessions were archived.

`prompt.receipt {session_id, admission_id, include_result:true}` was also exercised against the
live authority: its status reached `terminal` without resubmission. Terminal means the admission
has settled, not that the model succeeded. When a cold-start transcript cannot identify a local
accepted message by submission/row ID, the app retains that text as a saved copy in Chat settings
after terminal receipt evidence. It does not infer identity from equal message text.

These checks used Node transport through Tailscale, not the disconnected Android phone.

## Milestone 5 hook activation observation — 16 November 2026

After config backup and user-plugin deployment, `hermes plugins enable phone-notify` reported
that the running gateway hot-reloaded the hook plugin. Contrary to PLAN.md's expected activation
step, no gateway restart was required or performed. A PC-only own GUI session completed a no-tools
prompt and its generic completion alert/session link was observed through the private HTTPS ntfy
API; that own session was archived. This proves the ordinary GUI-worker hook path for this test,
not Android delivery or a real Desktop UI interaction. Actual human-input hook delivery, automatic
turn noise and protected/safe worker coverage remain bounded by `tools/notifications/HOOK_CONTRACT.md`.

## Continuity-first voice smoke — 16 November 2026

Actual Node requests used the existing Tailscale HTTPS origin on port9120 and deployment Bearer
authentication. No gateway restart, configuration/provider change or Hermes source edit was needed.

- `POST /api/audio/transcribe` accepts `{data_url,mime_type}`. A synthetic WAV returned
  `{ok:true,transcript,provider:"local"}` with HTTP200. Both audio endpoints returned401 without auth.
- `POST /api/audio/speak` accepts `{text}` and returned HTTP200 with `{ok:true,data_url,mime_type,
  provider:"edge"}`. The returned audio/mpeg was29952bytes and independently decoded by FFmpeg to
  4.992seconds of PCM. This verifies returned media decoding, not phone playback or listening quality.
- First Windows David synthetic recording failed exact word recognition: the gateway returned a
  different word for "lantern" and rendered seven as7. The original WAV and failed results were
  retained. A second recording using installed Zira Desktop, rate-1, of the **same phrase** returned
  all six correct words. No fuzzy word acceptance or gateway change was used to make it pass.
  The smoke accepts only exact words, with the equivalent final number renderings seven or7.
- The successful3.079second input took1062ms to transcribe; speech generation took1026ms on that
  run. These are PC-generated fixtures through Tailscale, not handset latency measurements.
- A separate encoding check converted that same WAV to mono44.1kHz AAC in an M4A container,
  sent as `audio/mp4`, matching the planned native recorder format. It also returned200 with the
  correct words (seven rendered7) in953ms. Evidence `.artifacts/audio-smoke/m4a-result.json`;
  probe `tools/smoke/audio-m4a-probe.mjs`. FFmpeg conversion and fixture provenance remain explicit.
- An own GUI fixture was seeded, disconnected, then resumed by another canonical client. The
  transcribed words were submitted through the ordinary durable `CanonicalClient.submit` path,
  without `voice_turn`, `voice_context`, model mutation or a new session at the handoff. The model
  recalled the seeded unique code. Another viewer saw exactly one identical saved user row.
  Snapshots before/after both reported model `gpt-6-luna`, provider `openai-codex`, reasoning effort
  `medium`. The fixture was archived in cleanup.

Reproduce with `tools/smoke/generate-audio-fixture.ps1`, then
`node tools/smoke/audio-smoke.mjs --audio-only`; after compiling the protocol probe runtime,
`node tools/smoke/audio-smoke.mjs --continuity-only` uses the hash-bound successful audio evidence
without repeating provider calls. `--speech-only` is diagnostic and cannot satisfy the STT gate.
Ignored evidence: `.artifacts/audio-smoke/{audio-result,continuity-result,speech-result}.json`.

This does not prove arbitrary speech accuracy, microphone capture, handset audio routing, actual
Desktop UI interaction or Android lifecycle behavior. First app mode must allow transcript review
and retain the canonical chat as the authoritative history. Upstream `voice_turn:true` can activate
auxiliary voice model/reasoning defaults; deliberately omit it to preserve session settings.

## Voice refinement synthesis check — 17 November 2026

The existing authenticated `/api/audio/speak` route was exercised through Tailscale with a synthetic
long reply formatted by the actual new speech formatter. It produced 5,322 spoken characters in
three lazy-sized parts: 1,992, 1,964 and 1,364. Every request returned HTTP200 audio/mpeg and the first
second of each returned file decoded to PCM successfully. No new gateway method, model route, provider, config or restart
was needed. No prompt was submitted to an existing user session by this check.

Evidence is under ignored `.artifacts/stability-20261116/speech-parts-live.json`. An initial harness
decode used a stdin pipe with an intentional one-second output limit; Node reported EOF when the
decoder closed the pipe early despite a successful exit and valid PCM. The corrected harness reads
from a temporary owned file, then removes it. Failed evidence is retained; this was a probe issue,
not a failed gateway audio response. These checks do not establish Android playback or audio routing.

## Hands-free latency and pending presentation — 17 November 2026

`tools/smoke/voice-latency.mjs` uses only synthetic content, existing audio endpoints and an owned,
archived GUI fixture through the Tailscale origin. First measured run: STT1,390ms, connect35ms,
resume186ms, submission receipt27ms, first exact-admission text2,023ms and complete2,573ms from submit.
Synthesis of320characters took1,813ms;1,900characters took12,772ms. Default fixture model was
gpt-6-luna, medium reasoning; model/provider/reasoning were unchanged. These are PC-side timings,
not the owner's selected phone chat, phone RTT, native file/player startup or a latency guarantee.
Evidence: `.artifacts/handsfree-20261117/latency.json` (latest rerun replaces numeric evidence).
Second run: STT1,195ms, receipt7ms, first text1,643ms, complete2,197ms; synthesis320characters1,217ms
versus1,900characters8,279ms. The live pending transitions included both `queued` and `started`,
confirming the queue presentation distinction against the running gateway. Both fixtures archived.

Read-only source verification of `gateway/session_authority.py::_publish_pending` and
`gateway/session_queued_controls.py::pending_rows` confirms that canonical `pending` includes
started admissions and steering transfers as well as queued/unknown work. The mobile UI previously
treated every pending item as queued. Count and expose queue edit controls only for status `queued`;
status `unknown` retains explicit uncertain-delivery recovery. Preserve the complete pending state
for reconciliation and capture readiness; this is a presentation correction, not a gateway change.

Hands-free still uses ordinary submissions: no voice_turn/voice_context and no model mutation.
Only authoritative, exactly correlated completion is spoken; streamed text may include interim
narration before further tool work. Endpoint detection and automatic rearming are client-local.

## Mobile model catalog correction — 17 November 2026

Real `model.options` with `explicit_only:true` still returned18 Anthropic models,15 OpenAI Codex
models and4 `ollama-launch` models. Source `hermes_cli/inventory.py::_filter_explicit_provider_rows`
also counts a Claude Code OAuth login as explicit configuration. Thus `explicit_only` does not mean
the owner's intended OpenAI/local-only mobile scope. No auth store was read to diagnose this.

Keep requesting `explicit_only:true`, then apply the owner-specific mobile policy in one shared
formatter: OpenAI/OpenAI Codex, explicitly user-defined providers (`is_user_defined`/`user-config`)
and managed local-runtime providers. Do not special-case current Anthropic into the picker. This is
an intentional mobile provider policy, not a general inference of all Hermes configuration.
Individual OpenAI model choices still come from that provider's gateway catalog; no model names are
hard-coded. Live global and existing-session probes both yielded15 OpenAI and4 Ollama choices,
with no Anthropic choices. Saved provider identity, disabled choices and gateway defaults remain.
Evidence: `.artifacts/model-options-probe.json`; script `tools/smoke/model-options-probe.mjs`.


## Reasoning picker verification - 17 November 2026

`tools/smoke/reasoning-picker.mjs` used the canonical client through the existing Tailscale URL,
created/resumed an owned idle GUI fixture and exercised session-only reasoning mutations without
submitting a prompt. Accepted/requested values: none, minimal, low, medium, high, xhigh, max, ultra.
`null` reset restored the profile-derived medium level; an invalid string was rejected. Model
and provider stayed gpt-6-luna/openai-codex throughout. `session.info.reasoning_effort_wire` showed
minimal -> low and ultra -> max; none had an empty wire string. Every fixture is archived.
Evidence: `.artifacts/usability-batch/reasoning-smoke.json`.

Source inspection confirms mutation validates the Hermes vocabulary, while provider/model routing
can clamp again. `model.options` deliberately omits supported_efforts; a boolean reasoning flag
is not a supported-level enum. Mobile therefore labels the choices Hermes reasoning levels and
shows requested/effective values when reported. Busy changes can return status deferred and apply
after the current turn. No per-provider execution acceptance is claimed from this metadata test.
The initial probe attempt omitted openSession and failed in the client before mutation; its empty
fixture was recovered and archived. No running gateway contradiction was found.
