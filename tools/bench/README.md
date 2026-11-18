# Host benchmarks

```powershell
npm run bench
```

These benchmarks drive the real `AppManager` (`app/src/state/index.ts`) through fake native and
gateway adapters, the same way `app/src/state/manager.test.ts` does, and print counts and sizes.
They exist so performance changes can show before and after numbers. They measure work the
JavaScript code asks for, not time: no frame times, no SQLite speed, no phone. They are not part of
`npm run test:host` or CI and have no thresholds.

The output is deterministic. Timers are faked, IDs are counter-based UUIDs of real length, and
nothing reads the clock. Two runs must print the same table; if they do not, that is a bug here.

## Fixture

Every scenario starts from a fresh manager restored through the real cache-restore path: eight
cached chats of 50 transcript rows (about 1,024 characters each, Markdown with a code fence), built
with the real `snapshotChat`, plus 40 session-list rows. On connect the manager refreshes the
inventory and reattaches the eight recent chats, as the app does. Counting starts after that settles.

The fake client follows the real `CanonicalClient` ordering: `openSession` sends `session.resume`
only for a session it has not attached; `submit` calls `persistSubmission`, then sends
`prompt.submit`, then calls `acknowledgeSubmission`.

"Chars" are JavaScript string lengths of the values written to the `app_cache` table. The fixture
is ASCII, so this equals UTF-8 bytes. "One full cache write" in the header is the size of a single
`persist()` of this fixture, for scale.

## What each number means

1. **Streamed reply.** One 4,000-character reply arrives as `message.start`, 100 `message.delta`
   events and `message.complete` in the open chat. Cache writes and characters serialized from the
   first event until everything settles, including the transcript refresh after completion. Shown
   at two delta spacings: 100 ms (every delta lands in its own 50 ms event flush) and 20 ms (several
   deltas share a flush). Most writes come from `scheduleCache`, which persists the whole state at
   most every 500 ms while events arrive.
2. **Send.** One `send()` in the open chat until the gateway acknowledgement has been saved, split
   at the moment `prompt.submit` goes out. "Before" is what delays the request leaving the phone.
3. **Open a chat.** Characters written between calling `openSession()` and the client asking the
   gateway. "Uncached" is a session from the list that is neither cached nor attached, so the
   client sends `session.resume`. "Recent cached" is one of the eight recent chats; the client
   already holds it after reconnect and answers without `session.resume`, which the table shows as 0.
4. **Live text.** For the same streamed reply as scenario 1, every store emission where the open
   chat's `liveText` changed, and the sum of `liveText.length` across those emissions. Each such
   emission gives `ChatScreen` a new live item, and the Markdown renderer and `extractImages`
   process the whole text again, so this sum stands in for Markdown parse input. The final emission
   that clears `liveText` on completion is counted and adds zero characters.
5. **Typing.** 80 single-character `setDraft` calls, 150 ms apart, in the open chat. Cache writes
   and characters serialized (these are the small draft checkpoints, not full persists), and store
   emissions that replaced the `drafts` object. `ChatScreen` selects `s.drafts`, so each of those
   emissions re-renders the whole chat screen.

## Changing the benchmark

Keep it counts-only and deterministic. If a change to the app makes a number move, that is the
point; record the before and after in the pull request. Change the fixture or the scenarios only in
their own commit, so a number never changes for two reasons at once.
