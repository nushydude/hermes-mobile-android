# ADR 0009: Review Android shares before adding them to a draft

- **Status:** Accepted
- **Decision date:** 17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The approved usability batch includes sharing text, URLs and images from Android apps into an
existing Hermes session or an explicitly new one. External URI grants can expire, apps can supply
unexpected content, and a share must not overwrite a draft or send itself.

## Decision

Use a local Expo Android module and a private, durable inbox under `noBackupFilesDir` to receive
supported shares. Show a review sheet with editable text and an explicit destination. New chat uses
gateway defaults. Add the content to the selected session's existing draft only after the owner
chooses Add to draft; submission remains a separate action. Plain text can be drafted offline;
images first use the existing gateway image-upload route.

Validate content URIs, MIME types and image signatures. Bound text to 100,000 characters, each image
to 25 MiB, a share to 10 images and 100 MiB, and committed inbox entries to 20. Use a 15-second
whole-share provider deadline and at most two daemon provider workers. Only the caller can commit
staged images; timed-out work cannot publish a manifest. Persist the shared draft and import identity
before deleting the original inbox item. Preserve draft-image references through alias and cache
reconciliation, and require an oversized merged draft to be reduced before sending.

## Alternatives

Relying on the sender's temporary URI grant after navigation or process death can lose access.
Automatically choosing a conversation or sending incoming content would bypass the owner's review.
Pretending that PDF or arbitrary file uploads work would exceed the verified image-only submit path.

## Consequences

Independent preview copies are cached and Android may evict them; uploaded attachment references
remain in the saved draft. A permanently stalled provider can occupy up to two bounded workers until
the process restarts, after which further image shares show a busy error while the inbox and text
shares remain usable. An Android intent redelivered after process recreation can appear as another
reviewable item, but it does not automatically send a prompt. One extra share can wait only in memory
when the inbox is full, so it may need to be shared again.

## Evidence

[PLAN.md](../../PLAN.md) and [PC_SETUP.md](../../PC_SETUP.md) record the owner-approved batch,
limits and release checks. See [the local native module](../../app/modules/hermes-sharing/) and
[share chooser](../../app/src/sharing/IncomingShareSheet.tsx). Native unit and host tests passed;
actual cold/warm Android delivery, URI grants and image handling remain owner phone acceptance.
