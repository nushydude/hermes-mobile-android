# Development and release workflow

Commands assume PowerShell at the repository root. See [setup](../PC_SETUP.md) for machine rules.

## Toolchain

The app uses Expo SDK 58, React Native 0.88.1 and React 19.3.0 with TypeScript, Node 24 and npm workspaces.
Python 3 runs the PC notification-hook tests. Android Studio, an Expo account and cloud builds are
not required. The recorded local toolchain is JDK 17, Android platform 37/build-tools 37.0.0,
NDK 27.1.12297006, CMake 3.22.1 and Gradle 9.4.1. Target SDK is 36; compile platform is 37.
These are this installation's recorded versions, not a recommendation to update blindly.

First-time setup:

```powershell
npm ci
& tools/android/bootstrap.ps1
# Connect/unlock the phone, enable USB debugging and approve this PC.
& tools/android/install-sdk.ps1
```

Bootstrap checksum-verifies downloads and installs under ignored `.toolchain/`. It accepts SDK
licences and changes environment variables only in its process. `install-sdk.ps1` reads the phone
API and React Native requirements. For existing tooling:

```powershell
. tools/android/env.ps1
adb devices
```

## Source layout

| Path | Purpose |
| --- | --- |
| `app/App.tsx`, `app/src/screens/` | Native navigation and screens |
| `app/src/state/` | Canonical session manager, reducers, cache/outbox and HTTP adapters |
| `app/src/components/` | UI, voice/search/filter helpers and tests |
| `app/src/sharing/` | Native bridge and reviewed incoming-share flow |
| `app/modules/hermes-sharing/` | Local Expo Android module and JVM tests |
| `app/plugins/` | Durable native-prebuild customizations; generated Android files are not authoritative |
| `packages/hermes-protocol/` | Authenticated transport, canonical session layer and vendored contract |
| `tools/android/`, `tools/smoke/`, `tools/notifications/` | Local build, gateway checks and PC notification tooling |
| `docs/adr/`, `docs/designs/`, `docs/releases/` | Decisions, approved UI references and release evidence |

## Build modes

```powershell
npm run android:build
npm run android:preview
```

The first creates a debug development client at `.artifacts/hermes-mobile-development.apk`.
Interactive Metro use needs trusted HTTPS; cleartext is disabled and no Metro Serve mapping has
been configured. The second creates the standalone release-variant Preview APK with embedded JS
at `.artifacts/hermes-mobile-preview.apk`; this is the sideload workflow used so far.
Build output is captured in `.artifacts/android-build.log`.

Default builds prebuild the ignored `app/android/` tree. The local share module is discovered by
Expo autolinking. Manifest changes belong in config plugins; shared native code belongs in the
local module. Do not modify the Hermes checkout or treat generated native files as durable source.

`tools/android/build.ps1 -Variant Preview -SkipPrebuild` is only suitable when the existing native
project already matches app config, dependency/autolinking and version metadata. Use full prebuild
after changing those inputs. Preserve the installed signing identity before any regeneration.

## Signing and update identity

Current generated Gradle configuration signs **both debug and release variants with
`signingConfigs.debug`**, using `app/android/app/debug.keystore`. Release shrinking does not imply
production signing. The installed preview lineage has retained certificate SHA256:

```text
fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
```

That fingerprint is public metadata, not key material. No dedicated production keystore or verified
private key backup has been established. Keep keys out of Git and do not regenerate/change the
identity as a documentation or routine build task. A signing migration needs a separate decision
that accounts for in-place updates and retained local data. See [ADR 0010](adr/0010-android-packaging-and-signing.md).

Before installation, verify APK signature/certificate, application ID/versionCode/versionName,
embedded JS, TLS settings, permissions, native share export and the single required icon font.
Use `adb install -r`; never uninstall/clear data to force an update. Wait for Success after any
owner-side Play Protect step. See [verification](verification.md) and [release record](releases/0.3.0.md).

## Compatibility constraints

- Keep the Room constructor R8 rule in app.json; it repairs the observed notification startup crash.
- Keep `RECORD_AUDIO`; image-picker's microphonePermission=false can remove it globally.
- Voice background recording/playback remain disabled; only remoteMessaging is declared as a foreground service.
- Import Ionicons directly; the vector-icons barrel previously bundled unnecessary fonts.
- Preserve MarkdownIt/linkify compatibility; do not force an incompatible transitive major version.
- Existing moderate dependency advisories need assessment, not `npm audit fix --force` downgrades.

## Change workflow

1. Read PLAN, the relevant ADR/design and protocol observations.
2. Keep changes scoped; verify internal gateway assumptions with an owned fixture before relying on them.
3. Run affected checks, strict types and required contract/native checks. Obtain independent review
   for consequential changes and repair demonstrated failures.
4. Update app.json version/versionCode, app/package.json version and lockfile metadata together.
5. Freeze source/artifact identity and record actual evidence and remaining owner acceptance.
6. Update status, changelog, release record and relevant ADR. Install only within owner authorization.

After a Hermes update, run `npm run check:contract` against a separate local Hermes source checkout. This check requires that checkout and is not part of a clean-clone offline quickstart; set `HERMES_HOME` when the Hermes home is nonstandard or `HERMES_SOURCE` to the source checkout. If it differs, use `npm run sync:contract`,
inspect changes, typecheck/test and run the attended smoke procedure. Sync only copies from Hermes.
See the [protocol package guide](../packages/hermes-protocol/README.md).
