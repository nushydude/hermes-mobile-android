# Contributing

Thanks for helping improve Hermes Mobile. This is a small Android client developed
around one real Hermes deployment. Compatibility with other gateway versions needs
verification; the gateway protocol is internal.

For substantial features, open an issue describing the user-visible behavior first.
For fixes, describe how to reproduce the problem, the expected result and relevant
Android/app/gateway versions. Redact addresses, transcripts and credentials.

## Local checks

Use Node.js 24 and Python 3. From the repository root:

```sh
npm ci
npm run typecheck
npm run test:host
```

These checks do not contact a gateway. Android native checks and APK build
instructions are in [development](docs/development.md) and
[verification](docs/verification.md). `npm run check:contract` requires a separate
Hermes source checkout; it is not a clean-clone offline check.

Live probes can create sessions, submit prompts, execute commands or trigger
approval requests. Read [the smoke guide](tools/smoke/README.md) and use your own
deployment. Do not run them against someone else's gateway. Never restart a shared
gateway without its operator's approval.

## Pull requests

- Keep changes focused and preserve session/model/reasoning continuity.
- Include meaningful checks for behavior you change and describe what you could
  not verify on a phone or real gateway.
- Update relevant guides, the changelog and protocol observations. Record enduring
  architecture choices in an [ADR](docs/adr/README.md).
- Preserve upstream protocol licenses and provenance. Do not edit generated vendor
  files as an independent protocol fork.
- Keep credentials, QR codes, signing keys, chat exports, private addresses, local
  gateway config and generated Android projects out of commits.

Use your own build/signing identity for redistribution. Do not imply that a debug
signed development build is a production release. See
[signing and updates](docs/development.md#signing-and-update-identity).

Contributions are accepted under the [MIT license](LICENSE). Be respectful and
constructive in issues and reviews.
