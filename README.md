# Pathstone

A calm, local-first workspace for tasks, projects, and a realistic day.

No framework, no build step, no account, no cloud. You open the page in a
browser, everything you capture and plan is saved to your browser's local
storage on your own device, and the whole app keeps working offline once the
service worker has cached it.

---

## Highlights

- **Today view** — a daily capacity ring (8h default), a **plan check** that
  suggests moves and explains what it found, calendar events with buffer
  blocks, and momentum cards driven by real activity.
- **Board** — five-column kanban with drag & drop on desktop; on touch
  devices, tap a card and move it from its editor.
- **Projects** — requirements, definition of done, docs, owners, target
  dates, live progress.
- **Top 3** — three priority slots per day. Moving an occupied slot bumps
  its holder rather than overwriting it.
- **Capture inbox** — capture first, date later; the plan check reminds you
  to close the loop.
- **Repeating tasks** — none / daily / weekdays / weekly. Completing a
  repeating task spawns the next occurrence automatically.
- **Sweep, don't postpone** — overdue tasks are swept to an *undated backlog*
  (visible count + a **Decide** action in the plan check) instead of bouncing
  to tomorrow forever.
- **Backups & restore** — a snapshot is stored daily when the vault changes,
  **Back up now** stores one on demand, imports and restores stash a safety
  catch first, and the Backups list restores any of it in one click. The
  newest 14 daily snapshots are kept (30 total).
- **Workday boundary** — after 17:00 local time the plan check declares the
  day closed; nothing is forced to move tonight.
- **Focus timer** — start/stop button in the momentum card; real minutes are
  logged when you stop (runs under a minute are not logged — honesty over
  vanity numbers).
- **Weekly review & shutdown rituals** — three honest lines to close a week.
- **First run** — choose a demo workspace or a blank vault; demo data is
  badged and one click empties it.
- **Daily reminder** — optional, honest web-notification recap when the app
  opens. Fires only while the tab is open; the button says exactly that.
- **Four themes** — `dusk` (default), `warm`, `paper`, `ink`. Also via
  `?theme=paper` in the URL.

## Quick start

Persistent mode (the real database):

```bash
python3 server.py        # or: npm start
# opens http://127.0.0.1:8247
# creates data/pathstone.db — a real SQLite file with WAL sidecars
```

Offline-only mode: any static file server still works (`npm run start:static`,
`npx serve .`) — the vault then lives in IndexedDB and the UI says so
honestly. Serving over HTTP is required; `file://` can silently block
storage in some browsers.

If storage is not available in your browser context, the save pill says
**Storage unavailable** in plain words — the app will not pretend to save.

## Data & privacy

Three storage tiers, newest-wins at boot, fully on-device:

1. **SQLite file** — `data/pathstone.db` (created by the local server):
   transactional, WAL-journaled, lives on your disk, backed by WAL/SHM
   sidecars. This is the database. The `data/` directory is never committed.
2. **IndexedDB** (key `pathstone-db`) — on-device fallback when the server
   is not running. Vaults migrate across tiers automatically; a vault that
   exists only in the fallback tier moves into SQLite the first time the
   server meets it.
3. **localStorage mirror** (key `pathstone-vault-v1`) — synchronous and
   instant; a crash between the other two tiers can never lose the last
   change, and boot-time reconciliation converges everything.

- **Backups** (vault card → Backups): automatic daily snapshots, manual
  "back up now", and safety catches before every restore/import — restore
  any of them with one confirm. Newest 14 daily snapshots kept (30 total).
- **Export / Import** JSON from the vault card: the portable, human-readable
  file (`Downloads/pathstone-vault-<date>.json`), and the only thing that
  crosses browsers or devices. Export nudges when stale (~2 weeks).
- Clearing site data still deletes every tier — export first.
- If storage is blocked, the save pill reads **Database unreachable** or
  **Storage unavailable** in plain words. It never pretends to save.

## Offline & install

A service worker (`sw.js`) serves same-origin requests offline and falls back
to the index shell on failed navigations. After one load with network, the
app installs itself for offline use and can be installed as an app through
the browser's install menu.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Open the command palette |
| `Esc` | Close the current layer/overlay |
| `Enter` / `Space` | Open the focused task card |
| `Tab` inside modals | Focus is trapped inside the layer |

## Testing

The app itself has zero dependencies and no build step. There is an optional
developer test suite (jsdom) that boots the real app and checks behavior:

```bash
npm install      # installs jsdom + fake-indexeddb as dev dependencies only
npm test         # 90 jsdom assertions + 20 real-server integration assertions
```

Notes on the harness live in `tests/test_pathstone.js` — including the two
classic pitfalls it guards against (script inlining order, and `$`-escaping
when injecting code via `String.replace`).

## Project structure

```
index.html            — the single page (all views/overlays live here)
styles.css            — the whole visual system
manifest.webmanifest  — PWA install metadata
sw.js                 — offline cache (stale-while-revalidate; API passthrough)
server.py             — stdlib-only local server: static files + the vault API
data/                 — runtime SQLite database (pathstone.db + WAL sidecars)
js/core.js            — state helpers, time math, plan check, themes, save flow
js/db.js              — the database layer: SQLite(server) / IndexedDB / mirror
js/seed.js            — seed data, blank-vault factory, import validation
js/render.js          — chrome + dashboard rendering
js/views.js           — lists, board, palette, week views
js/actions.js         — every user action (capture, move, complete, repeat…)
js/events.js          — init, bindings, keyboard, heartbeats, storage probe, boot
tests/                — jsdom suite + real-server API integration suite
```

## Documentation

- `POSTMORTEM.md` — the product's failure post-mortems in reusable form:
  the first two deaths, what was fixed and proven, what was consciously
  shelved, and the blank template for running the same autopsy on anything.
- `DB_POSTMORTEM.md` — the third and fourth autopsies: how the IndexedDB +
  backup feature could have died before shipping, and how the SQLite `.db`
  release went from three storage tiers to a real caught-in-tests bug.

## Known limits (by design)

- Single-user by design; syncing across devices is consciously postponed.
- Web notifications fire only while the tab is open — a browser platform
  limit, stated on the toggle itself.
- There is no build pipeline, no telemetry, no updates beyond the files here.

## License

[MIT](LICENSE) © 2026 luel-4013
