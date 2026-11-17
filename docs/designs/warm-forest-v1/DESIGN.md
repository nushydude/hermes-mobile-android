# Warm forest v1 — approved 16 November 2026

Owner: “Yes, this looks good. Let's build it.” Execution authorized; implementation not started
when this reference was saved. PLAN.md remains the project source of truth.

Approved visual references: [Home and Chat](home-chat.png), [Needs you](needs-you.png),
[self-contained editable preview](preview.html) (`?state=attention` shows the request variant).
These are synthetic HTML mockups rendered at 1100×1200 with two 412dp phone frames, not native
app screenshots. Sample conversation titles, category labels, times and checkmarks are illustrative;
do not add categories, read receipts or invented timestamp data. Workspace labels derive actual cwd.

## Design contract

- Palette: bg #111D1B, surface #1B2B26, raised #263A32, border #30473D, text #F3F4EC,
  muted #A4B8AC, mint #B7E8CB, ink #1A3729, peach #EDC5A7, warning #F2CA85,
  warning surface #3B3123, user bubble #D1E8D7.
- Home: compact expressive Hermes sparkle mark, 31dp title, 48dp settings control; conditional
  working/needs-you summary. Rounded search, roomy soft chat cards, decorative icon tiles,
  actual titles/previews and short workspace labels. Needs-you amber precedes working mint.
  Preserve pinned/unread/unavailable states. Existing New chat action becomes a 56dp floating pill;
  reserve list padding below it. No routine Connected banner.
- Chat: 48dp back target plus hit slop, 18dp title, single-line model subtitle and existing settings
  access. Stop stays one tap away. Borderless soft assistant bubbles, pale mint user bubbles,
  23dp corners, 16/24dp message type. Compact Hermes mark/name; discreet labelled copy actions.
- Composer: one 58dp rounded surface containing camera, attachment, single-line flexible input
  and send. All icon hit targets minimum48dp despite slightly narrower illustrated icon wells.
  No automatic Enter/paste send. Drafts, attachments, queue, steer, stop and submission guards remain.
  Status sits immediately above, with mint activity indicator and available Steer action.
- Requests: amber inline approval/clarify cards with explicit warning border and sticky request
  banner. Preserve secure-input, errors, every queue/recovery action and activity visibility setting.
- Shared surfaces: 22dp card corners, minimum48dp buttons, quieter labels and fewer borders;
  explicit warning outlines survive. Font scaling may grow rows/sheets; truncate metadata only.
  Composer stays one row at narrow widths, with correctly padded keyboard and safe-area handling.
- Connection grace: hide incidental connection notices for ten seconds of each foreground attempt
  or new disconnect interval; navigation/non-ready flaps cannot reset the deadline. Connect starts
  immediately and cached content stays available. Show continuing failure after ten seconds.
  User-work feedback, delivery failures, unknown delivery and required requests stay honest/visible.

## Execution and acceptance

This chat orchestrates with the installed orchestrate workflow. Terra implementor owns the scoped
native UI; main integrates, checks and builds; independent Sol reviewer receives the same approved
design images/contract and actual code/test packet. No gateway/config/protocol changes or new account.
Preserve configured-only model/provider and workspace pickers, virtualized history, streaming batching,
endpoint isolation, notification behavior and the Room constructor keep rule.

Verify workspace typechecks, app state/helper tests (including connection grace), native release
build and bundled icons. Review actual changes against the saved reference. Owner has elected to
perform phone behavior/layout tests; main installs without broad device tests. Check large/narrow
text, keyboard, controls, cached startup, message send/queue, model picker and request handling in
that owner acceptance. No one-second network connection guarantee is inferred from the mockup.

Implementation should re-read PLAN.md/current repository guidance and these references, check drift,
then build and verify the approved scope. Update this record and PLAN evidence after delivery.

## Implementation evidence — 16 November 2026

Native Home/Chat/shared surfaces implemented against this revision, including the saved quiet-startup
and compact-composer behavior. Main workspace types and 104 app/helper/preference tests passed.
Independent Sol source review found three issues: unbounded Home summaries, low-contrast image
placeholders in light bubbles, and unnecessary icon families. One repair cycle addressed all three;
final delta review was clear. Main reran workspace types and the implementor's focused helpers passed.

Clean optimized release build passed (1m42s), embedded JS and exact Ionicons font verified. The APK
contains one 389,724-byte icon font (previous candidate:19 fonts/4,076,840 bytes). Final source hashes
match the verified candidate. APK `.artifacts/hermes-mobile-preview.apk`, SHA256
`d5ef0a2ebbbc7aea12adf3b51f9f1fa50f431badcb2027a5ca28894729be4c09`, 31,481,282 bytes.
USB phone reconnect requested; installation and owner native layout/behavior acceptance pending.
No device tests performed. These source/build checks do not establish native pixel equivalence.
