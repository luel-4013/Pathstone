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

## Verification (v0.2)

- Suite grew to **82 passing assertions** — new coverage: vault lives in the
  database and flushes, daily-snapshot stamp, manual snapshot → junk task →
  restore rewinds exactly, safety catch after restore, backups list renders
  restore tokens, prune drops oldest (14 daily cap, safety catches spared),
  newer-copy-wins tie-breaks (db/mirror/null/blank), unreachable-database
  rejection surfaces, snapshot flow no-ops when down.
- All modules pass syntax checks; service worker keeps the new module in its
  offline cache with a bumped cache generation.

---

## The SQLite server — how the vault became a real database file (v0.3)

*Added at the owner's request: "localStorage is not a database — give me a
proper `.db` file like the sibling projects." The answer is a three-tier
design with newest-wins reconciliation.*

### The architecture in three lines

1. **SQLite** — `data/pathstone.db` (WAL-journaled), owned by a
   dependency-free `server.py` that serves the app plus a small JSON API.
   This is the durable file database.
2. **IndexedDB** — the automatic fallback when the server is not running
   (plain static hosting, GH Pages clone). Same API surface, same snapshot
   semantics.
3. **localStorage mirror** — synchronous and instant, so even a crash
   mid-write cannot lose the newest change.

On boot all reachable copies are compared by timestamp; the newest becomes
the state and is pushed into every other reachable tier, so the engines
converge instead of silently diverging.

### Issues caught and fixed the day this shipped

1. **A service-worker tripwire nearly froze the vault in the past.** The
   offline cache intercepts same-origin GETs — including `GET /api/vault` —
   and stale-while-revalidate would happily keep serving yesterday's vault
   forever. `Fixed pre-ship`: the fetch handler passes every `/api/*` request
   straight through; a cache generation bump ships the fix.

2. **The snapshot identity split-brain.** The IndexedDB path generated
   snapshot ids in the client; the server path expected the caller to send
   one — and faithfully returned `undefined` as the id when it was not
   there. Cross-engine restore then bailed with a misleading "snapshot not
   found". **Caught by the mock-server regression test before ship**: the
   client now generates ids with one shared rule for both engines. This is
   the exact failure the mock-API harness exists to catch.

3. **Three generations of truth.** With three storage tiers, a crash can
   leave each one holding a different version. `Fixed pre-ship`: boot-time
   newest-wins across all reachable tiers plus a convergence push — the
   winner is written back to the others rather than trusted one-sidedly.

4. **The last write before an unload.** A debounced write meets a rarely
   fired unload on some platforms. `Mitigated`: `pagehide` is registered
   too, the flush uses fetch `keepalive` in server mode, and the instant
   mirror carries any residue for the newest-wins rule to finish at next
   boot.

5. **Server hardening.** Parameterized SQL only, WAL + busy timeout for
   multi-threaded/multi-tab writes, request-body size cap, hostile snapshot
   ids rejected, path traversal blocked — and the one that would have been
   embarrassing: **the `.db` file itself is not web-served** (the data
   directory answers 403). The server binds to localhost only.

### Honest residuals

1. **No server, no file.** On pure static hosting the vault lives in
   IndexedDB, honestly flagged in the UI. A `.db` file on disk exists only
   while the local server runs — that is what the file is.
2. **Multi-tab is last-write-wins.** WAL keeps the file consistent, but two
   concurrent tabs may race through the debounce window. Multi-device
   remains owner-shelved; single-device multi-tab is a single-player edge.
3. **`data/` stays out of git** (sibling convention: `data/`, `*.db`,
   `*.db-wal`, `*.db-shm`). It is runtime data; export JSON remains the
   portable artifact — the only file that is human-readable by design.

### Verification (v0.3)

- **90 jsdom assertions**, including a full server-mode client boot against
  a mock API: tier selection at boot, vault written through the API path,
  daily + manual snapshots stored server-side, restore through the API with
  a server-side safety catch, zero runtime errors in server mode.
- **20 integration assertions** against the real `server.py` and a disposable
  `.db`: schema bootstrap, file created with `.db` extension, vault round
  trip, snapshot store/list/fetch/delete, 400s on hostile input, 404 on
  unknown API routes, 403 on traversal and on the database file itself.
- Syntax checks pass on every module, both test files, and `server.py`;
  a live smoke test confirmed `data/pathstone.db` + WAL sidecars appear on
  first boot.
