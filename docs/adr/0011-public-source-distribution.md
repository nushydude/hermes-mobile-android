# ADR 0011: Publish reusable source with private deployment state excluded

- Status: Accepted
- Recorded: 2026-11-17

## Context

The owner requested publication at `nushydude/hermes-mobile-android` and welcomed
reuse by others. The project was initially written for one Windows gateway and
Android phone. Publishing that deployment's credentials, chat data or personal
addresses would not help other users configure their own installation.

## Decision

Publish source and generalized documentation under MIT, retaining the Hermes and
Expo notices. Host tools require explicit HTTPS origins and allow a configurable
Hermes home. Machine-specific originals remain in ignored local storage.

Keep private configuration, credentials, QR codes, local agent records, generated
native projects and APKs out of Git. Check the actual publication tree for secrets;
ignore rules alone are not evidence that a tree is safe. CI runs host checks
without gateway credentials or a live deployment.

Retain the current Android application ID for existing install compatibility.
Publishing source does not establish a production signing process, promise
compatibility with every gateway version or certify untested phone behavior.

## Alternatives

- Publish the original personal working tree: exposes unnecessary deployment
  details and directs strangers' tools at the owner's gateway.
- Publish only an APK: prevents straightforward inspection and contribution and
  requires a distribution/signing policy that has not been established.

## Consequences

Contributors can run offline checks from a clean clone. Live probes require their
own explicit setup and remain capable of changing test sessions. Maintainers must
keep public examples separate from local operational state and review every
publication for credentials and private data.

## Evidence and related documents

- [README](../../README.md)
- [Contributor guide](../../CONTRIBUTING.md)
- [Security policy](../../SECURITY.md)
- [Third-party notices](../../THIRD_PARTY_NOTICES.md)
- [Signing decision](0010-android-packaging-and-signing.md)
