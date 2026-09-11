# Crash-Safe Append and Recovery (P0-C)

## The bug this replaces

Before this phase (`spec/capability-boundary-audit.md` §27): `Ledger.append`
wrote with a single `fs.appendFileSync`. A crash or interrupted write mid-line
(large content, disk full, process killed) could leave a truncated final
line. On the next start, `Ledger.load()` called `JSON.parse` per line and
**threw** on the malformed tail — the entire ledger failed to load, not just
the last write. Recovery required manually editing the file. This phase
fixes that property without replacing the canonical JSONL model: the ledger
is still one append-only JSONL file; what changed is *how* a line gets into
it and *what happens* if the process dies partway through.

## Design: prepare → journal → fsync → lock → append → fsync → confirm → clear

Evaluated against the task's suggested shape and adopted with the following
concrete steps (`Ledger.append`, `src/recovery.js`, `src/writer-lock.js`):

1. **Prepare and validate** — build the candidate event, compute its
   `hash`/`prev_hash` against the current (resynced, see
   [single-writer-model.md](single-writer-model.md)) in-memory head, inside
   the locked critical section.
2. **Write to a temp journal** (`<ledger>.journal`, `journalPath()` in
   `src/recovery.js`) — a single JSONL line, the exact bytes that will be
   appended to the canonical ledger.
3. **fsync the journal** (`fsyncFile()`) — the journal line is durable on
   disk before anything touches the canonical file.
4. **Acquire the writer lock** — see
   [single-writer-model.md](single-writer-model.md) (in the actual
   implementation the lock is acquired first, around the whole critical
   section, so journal-write and ledger-append are both inside it — see
   `Ledger.append`).
5. **Append the line to the canonical ledger** (`fs.appendFileSync`
   equivalent via an explicit `open`/`write`/`fsync`/`close` sequence).
6. **fsync the ledger file** — the appended line is durable.
7. **Confirm the head, then remove the journal** (`fs.unlinkSync`) — only
   after the canonical write is confirmed durable does the journal get
   deleted; if the process dies between step 6 and step 7, the journal is
   merely an orphaned-but-harmless leftover of an *already-committed* write
   (see §Recovery journal below).

The important property, stated exactly as the task requires: **an
interrupted append must not silently produce an accepted, corrupted
canonical ledger.** Every intermediate state is either (a) the ledger
unchanged and a journal file present that was never applied, or (b) the
ledger correctly appended and a (possibly not-yet-deleted) journal that
exactly matches what's now in the ledger. Neither state is corruption;
neither is silently treated as success without being reported.

## The write-ahead journal is not canonical history

- `<ledger>.journal` is never read by `Ledger.load()`, `verify()`,
  projection, export, or the static build. It carries no TII identity.
- It is safe to remove once its content is confirmed committed (step 7
  above), and `tii recover discard-journal` removes it explicitly (with a
  backup) when it was never applied.
- It is gitignored (`*.journal`), same as lock files and private keys.

## Startup and mid-operation recovery detection

`Ledger.load()` (`src/ledger.js`) uses `recovery.parseLedgerTolerant()`
(`src/recovery.js`) instead of a hard `JSON.parse` per line: it parses every
line it can and **stops at the first unparseable line**, returning the valid
prefix plus a description of the malformed tail (byte offset, line number,
parse error). This is a property of stable file bytes and is safe to
determine without holding the writer lock.

- If a malformed tail is found, `load()` sets `this.recovery.required =
  true` and **does not** silently drop the tail or guess what was intended.
  The ledger loads read-only with the valid prefix; **writable mode is
  stopped** — any subsequent `append()` call throws `RecoveryRequiredError`
  (`code: 'recovery-required'`, mapped to HTTP `503`) rather than appending
  after (and implicitly accepting) unexplained missing history.
- Journal-file presence at `load()` time is recorded as
  `journalObservedAtLoad` but is **not**, by itself, treated as
  "recovery required" — a concurrent legitimate writer can transiently have
  a journal on disk mid-append, and deciding "this journal is orphaned"
  requires holding the writer lock (only then is it guaranteed no other
  process could legitimately be mid-write). The authoritative orphan check
  happens inside `append()`, after the lock is acquired: if a journal file
  is found there, it **must** be orphaned by construction, and
  `RecoveryRequiredError` is thrown with the journal path attached.
- **Diagnostic report** (`recovery.inspect(ledgerFile)`, also `tii recover
  inspect` / `GET /status`'s `recovery_detail`): non-destructively reports
  whether the file exists, the malformed tail (byte range, line number,
  parse error) if any, the last valid event, the expected next `seq`, and
  the journal's own state (does it parse? does its event match an event
  already in the ledger — i.e. was it already committed before the crash?).
- **Do not silently finalize ambiguous recovery state.** Nothing in `load()`
  or `append()` guesses "the journal was probably meant to be applied" or
  auto-truncates a malformed tail. Every repair requires an explicit
  operator command.

## Explicit recovery commands

```
tii recover inspect            # non-destructive diagnostic (also the default with no subcommand)
tii recover truncate-tail      # DESTRUCTIVE: removes exactly the malformed tail; backs up first
tii recover commit-journal     # completes a pending journal entry, only if it validates cleanly
tii recover discard-journal    # removes an orphaned journal WITHOUT applying it; backs it up first
```

- `truncate-tail` refuses to run if there is no malformed tail
  (`recover.inspect().malformed_tail` is null). It copies the damaged file to
  `<ledger>.damaged-<timestamp>` **before** modifying anything, then removes
  exactly the bytes from the first malformed line onward — every byte before
  the malformed tail is untouched, and the report states the exact removed
  line number and byte count. It never rewrites or reinterprets any valid
  earlier event.
- `commit-journal` re-derives the expected next `seq` and current head hash
  directly from the valid ledger prefix (bypassing `load()`'s recovery gate,
  since we are in the middle of resolving it), and refuses — rather than
  guessing — if the journaled event's `seq`, `prev_hash`, or self-consistency
  hash don't match exactly what's expected. If the journal's own event
  already appears in the ledger (i.e. the crash happened *after* step 6 but
  *before* step 7), it reports "already committed" and simply removes the
  now-redundant journal — no duplicate append.
- `discard-journal` backs up the journal file, then removes it without ever
  applying its content to the ledger — for the case where the journaled
  write itself should not have happened (e.g. the client that requested it
  is known to have failed) or the journal is itself corrupted and cannot be
  safely applied.
- All four are **operator-invoked only**. Nothing in the read path, the
  write path, or server startup calls any of them automatically.

## Required regression coverage (`test/crash-recovery.test.js`)

- A truncated final line is detected on load, `recovery.required` is set,
  and further `append()` calls are refused until repaired.
- An orphaned journal that was **never applied**: `commit-journal` completes
  it correctly (validates seq/prev_hash/hash, appends, removes the journal).
- An orphaned journal whose event **was already committed** before the
  crash: `commit-journal` detects this and simply cleans up the journal
  without double-appending.
- `tii recover truncate-tail` end-to-end via the CLI: backup created,
  correct bytes removed, ledger valid afterward.
- `tii recover commit-journal` / `discard-journal` end-to-end via the CLI.

`test/writer-lock.test.js` additionally includes crash-adjacent concurrency
coverage under real multi-process contention (see
[single-writer-model.md](single-writer-model.md)).

## Cost

Two `fsync` calls per successful append (journal, then ledger) are the
direct cost of this guarantee. Measured on this hardware: **~98
appends/second, ~10.2 ms/append**, versus ~7,800–9,800 appends/second before
this phase (`spec/performance-results.json`). This is a genuine, large
throughput reduction, not a rounding effect, and it is documented here and
in `spec/capability-matrix.json` / `spec/capability-boundary-audit.md`
without softening: crash safety was prioritized over raw write throughput,
per this phase's explicit instructions.
