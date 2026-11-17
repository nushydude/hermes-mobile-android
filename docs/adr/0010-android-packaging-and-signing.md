# ADR 0010: Android packaging, compatibility and current signing lineage

- **Status:** Accepted for the current preview lineage
- **Decision date:** 16–17 November 2026
- **Recorded:** 17 November 2026
- **Decision makers:** Owner and implementer

## Context

The personal app is sideloaded and must update in place without deleting its local data. Native
modules require an Android build rather than Expo Go. A release-shrunk notification build previously
crashed because an older Room consumer rule did not retain the database constructor used by reflection.

## Decision

Produce an arm64 standalone APK with embedded JavaScript from the Android release variant. Retain the
Expo build-properties Room constructor keep rule, disable cleartext traffic, and keep the native
notification foreground service limited to the declared remote-messaging type. Import the required
Ionicons font directly rather than bundling the vector-icons barrel. Retain the known compatible
Markdown dependency boundary documented in the audit.

The currently generated `app/android/app/build.gradle` signs both debug and release variants with
`signingConfigs.debug`, using `app/android/app/debug.keystore`. The installed preview APKs have shared
the same certificate and have updated in place. This describes the current build, not an established
dedicated production-signing key or a verified off-repo key backup. A future long-lived signing-key
strategy and any migration must be planned separately, including the effect on in-place updates and
local data. Do not commit a keystore.

## Alternatives

Running a development client requires a suitable Metro endpoint; the standalone APK embeds its JS.
Disabling shrinking globally would mask the Room issue rather than retaining the needed constructor.
Changing signing identity without a migration can prevent an Android in-place update.

## Consequences

The generated Android project and key are ignored by Git, so an Android prebuild or cleanup can affect
the existing signing lineage. Confirm the signing certificate before updating the installed app and
preserve the owner's ability to retain local data. A separate production-key solution remains open;
this ADR does not assert one has been created or backed up. Existing dependency advisories and native
acceptance must be assessed against the actual candidate, not a past APK.

## Evidence

The Room crash and repair are described in [NOTIFICATIONS.md](../../NOTIFICATIONS.md); build and
release evidence is in [PC_SETUP.md](../../PC_SETUP.md). The current rule is in
[app.json](../../app/app.json), and the build workflow is [build.ps1](../../tools/android/build.ps1).
Version 0.3.0 (7) installed over the previous app; its new phone behaviour still needs owner testing.
