# Database, Backup & Restore — Feature Post-Mortem

*The third autopsy, scoped to one release: moving the vault from
browser-string storage into a real database, with automatic snapshots and
restore. Written the same day the code was written — the honest moment to
list how this feature could die in user hands. Status tags follow the same
vocabulary as the main post-mortem (`POSTMORTEM.md`).*

---

## What was built, in two sentences

The vault's durable home is now a **real IndexedDB database** (`pathstone-db`),
transactional and quota-scalable, still 100% on-device with no account and no
cloud. The old string-storage copy remains as a synchronous **mirror** — an
instant write that always holds the newest change — and every day that the
vault changes, plus every import and restore, gets a **snapshot** users can
restore from a Backups list.

---

## How it could have died before it shipped

### 1. The silently-skipped snapshot `Fixed pre-ship`

The first implementation stamped "snapshot done for today" *before* the
async write resolved. If that write failed — background tab, private mode,
disk pressure — the stamp persisted, the day's snapshot never existed, and
the code believed it did. A backup feature that lies is worse than no
backups.

**Fix:** the stamp is written only after the snapshot write resolves; a
failed snapshot retries on the next change. An in-flight guard prevents a
burst of saves from launching duplicate writes.

### 2. Divergent copies after a crash `Fixed pre-ship`

Two stores holding the same vault will eventually disagree — a crash between
the instant mirror write and the debounced database write leaves the mirror
one change ahead. If boot blindly trusted the database, the last keystrokes
of every such session were silently rolled back.

**Fix:** on boot both copies are compared by `savedAt`, the *newer* wins, and
the winner is pushed into the other store, which eventually reconciles. The
tie case keeps the mirror, because its write finished last.

### 3. Ghost history — the empty list that lied `Fixed pre-ship`

When a snapshots read failed, the Backups list rendered as *"No snapshots
yet"* — indistinguishable from having no history at all. Trust dies at
exactly these seams.

**Fix:** read failures now render an honest third state — *"could not be
read just now, the vault itself is fine"* — distinct from a genuinely empty
history.

### 4. The mobile flush moment `Mitigated pre-ship`

`beforeunload` — the natural place to push the last debounced write into the
database — does not reliably fire on mobile browsers. Desktop gets the clean
flush; mobile often does not.

**Fix:** `pagehide` is registered alongside `beforeunload` as the flush
moment. Remaining honesty: on mobile the debounced window (≤400 ms) can
still end a session before the flush completes, which is exactly what the
synchronous mirror exists for — the newest change is never in it, but the
database can trail by one unsaved transaction until the next save. Verified
by the newer-copy-wins rule at boot.

### 5. The snapshot graveyard `Mitigated by design`

Snapshots that only grow are their own death: a year of daily snapshots
makes every list a ten-second scroll and every restore a hunt through a
landfill.

**Fixed:** the store prunes itself — the newest 14 daily snapshots survive,
nothing total exceeds 30 records, and safety catches are never pruned by
the daily counter (only by the global cap). Tests verify the *oldest* die,
not the newest.

### 6. Restore as a data-loss button `Mitigated by design`

One-tap restore straight over live state is the easiest way to destroy two
weeks of work with a mis-tap.

**Fixed:** restore double-gates — a plain-language confirm, and the current
state is written to a safety-catch snapshot *before* anything is replaced.
The same catch is taken before a JSON import. Tests prove the catch exists
after both flows.

---

## What can still hurt (kept honest)

1. **Both stores local.** The database lives in this browser, on this
   device. Clearing site data still deletes everything — export remains the
   only cross-browser/cross-device survival. Multi-device sync stays shelved
   (owner's call).
2. **Private-mode thresholds.** Some browsers cap or reject storage in
   private modes; the app degrades to the mirror with a visible
   "database off" state and says so.
3. **No snapshot for the unreadable mirror.** If the database was down
   during an import (and the user confirmed the replace), the pre-import
   state never enters the database — import confirmation is the only gate.
   Documented, not fixed.
4. **The 400 ms seam.** A crash inside the debounce window falls back to the
   mirror-newer rule; at worst the very last synchronous-only change
   survives via the mirror and reconciles on next boot.

---

## Verification

- Suite grew to **82 passing assertions** — new coverage: vault lives in the
  database and flushes, daily-snapshot stamp, manual snapshot → junk task →
  restore rewinds exactly, safety catch after restore, backups list renders
  restore tokens, prune drops oldest (14 daily cap, safety catches spared),
  newer-copy-wins tie-breaks (db/mirror/null/blank), unreachable-database
  rejection surfaces, snapshot flow no-ops when down.
- All modules pass syntax checks; service worker keeps the new module in its
  offline cache with a bumped cache generation.
