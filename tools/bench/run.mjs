// Runs tools/bench/scenarios.ts under vitest and prints a deterministic table.
// Vitest's own output (which includes durations) is shown only when a scenario fails.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

let root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// Vitest loads two copies of itself on Windows when the drive letter's case differs between
// paths ("c:" versus "C:"), so always run from an upper-case drive.
if (process.platform === "win32") root = root.replace(/^[a-z]:/, (drive) => drive.toUpperCase());

const out = path.join(tmpdir(), `hermes-bench-${process.pid}.json`);
const run = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules", "vitest", "vitest.mjs"),
    "run",
    "--config",
    "tools/bench/vitest.config.ts",
  ],
  { cwd: root, env: { ...process.env, HERMES_BENCH_OUT: out }, encoding: "utf8" },
);
if (run.status !== 0 || !existsSync(out)) {
  process.stdout.write(run.stdout ?? "");
  process.stderr.write(run.stderr ?? "");
  rmSync(out, { force: true });
  console.error("Benchmark failed.");
  process.exit(1);
}
const r = JSON.parse(readFileSync(out, "utf8"));
rmSync(out, { force: true });

const n = (value) => value.toLocaleString("en-US");
const rows = [];
const add = (scenario, metric, value) => rows.push([scenario, metric, n(value)]);

for (const key of ["stream100", "stream20"]) {
  const s = r[key];
  const name = `1. Streamed reply, delta every ${s.intervalMs} ms`;
  add(name, "cache writes", s.writes);
  add(name, "chars serialized", s.chars);
}
add("2. Send, before prompt.submit", "cache writes", r.send.before.writes);
add("2. Send, before prompt.submit", "chars serialized", r.send.before.chars);
add("2. Send, prompt.submit to ack", "cache writes", r.send.after.writes);
add("2. Send, prompt.submit to ack", "chars serialized", r.send.after.chars);
add("3. Open uncached chat", "chars before session.resume", r.openUncached.chars);
add("3. Open recent cached chat", "chars before client open", r.openCached.chars);
add("3. Open recent cached chat", "session.resume sent", r.openCached.resumed ? 1 : 0);
for (const key of ["stream100", "stream20"]) {
  const s = r[key];
  const name = `4. Live text, delta every ${s.intervalMs} ms`;
  add(name, "emissions changing liveText", s.liveEmissions);
  add(name, "sum of liveText.length", s.liveChars);
}
add("5. Typing 80 characters", "cache writes", r.typing.writes);
add("5. Typing 80 characters", "chars serialized", r.typing.chars);
add("5. Typing 80 characters", "emissions changing drafts", r.typing.draftChanges);

const f = r.fixture;
console.log(
  `Fixture: ${f.cachedChats} cached chats x ${f.rowsPerChat} rows of ${n(f.rowChars)} chars, ` +
    `${f.inventorySessions} inventory rows. One full cache write: ${n(f.fullWriteChars)} chars.`,
);
console.log(
  `Reply: ${n(r.stream100.replyChars)} chars in ${r.stream100.deltas} deltas. ` +
    `Counts only; no timings. See tools/bench/README.md.\n`,
);
const head = ["Scenario", "Metric", "Value"];
const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i].length)));
const line = (cells) =>
  cells.map((c, i) => (i === 2 ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join("  ");
console.log(line(head));
console.log(widths.map((w) => "-".repeat(w)).join("  "));
for (const row of rows) console.log(line(row));
