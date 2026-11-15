# Pathstone

[![Tests](https://github.com/luel-4013/Pathstone/actions/workflows/tests.yml/badge.svg)](https://github.com/luel-4013/Pathstone/actions/workflows/tests.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A calm, local-first workspace for tasks, projects, and a realistic day.

No framework, no browser build step, no account, no cloud. Everything you
capture and plan stays on your own device — in a local SQLite file inside the
desktop app, in `data/pathstone.db` when the companion server is running, and
in browser storage when neither is available. The whole app keeps working
offline once the service worker has cached it.

---

## Highlights

- **Today view** — a daily capacity ring (8h default), a **plan check** that
  suggests moves and explains what it found, calendar events with buffer
  blocks, and momentum cards driven by real activity.
- **Calendar** — a full month grid that shows every dated task, event, and
  project target in one place, plus a selected-day agenda and a next-14-days
  list. Create, edit, and delete events without leaving the view.
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

Requires Python 3.9+ (standard library only). Node 22.13+ is needed for the
developer test suite and desktop packaging.

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

## Desktop app (Electron)

The desktop shell runs the same UI from `app://pathstone` and replaces the
Python server with an embedded `node:sqlite` database in Electron's main
process. The packaged app is self-contained: no Python, no sidecar process,
and no listening HTTP port.

```bash
npm ci
npm run desktop:start      # development window
npm run desktop:package    # unpacked app in out/
npm run desktop:dist       # packages for the current OS
npm run desktop:dist:list  # show makers and missing host tools
```

For a guided, prompt-based setup and packaging run:

```bash
./pathstone-electron-setup.sh
```

It asks before overwriting files, installing dependencies, running tests,
building installers, committing, or launching the app.

`desktop:dist` wraps Electron Forge with target and toolchain checks. It can
build the host platform, a named platform, or every platform this host can
serve:

```bash
npm run desktop:dist -- --clean
npm run desktop:dist -- --platform linux --clean
npm run desktop:dist -- --platform all
npm run desktop:dist -- --platform win32 --arch x64
npm run desktop:dist -- --targets @reforged/maker-appimage
```

Packaging matrix:

| Host | Target | Artifact |
| --- | --- | --- |
| Linux | Linux | `AppImage`, `.deb`, `.rpm`, `.zip` |
| Windows | Windows | Squirrel `Setup.exe`, `.nupkg`, `.zip` |
| macOS | macOS | `.dmg`, `.zip` |
| Linux + `mono` + `wine` | Windows | Squirrel installer + `.zip` |
| Windows/macOS | other OS | `.zip` where the host tools permit |

Makers that cannot run on the current host are skipped and explained. For
example, DMG creation requires macOS, `.deb` requires `dpkg-deb` and
`fakeroot`, and `.rpm` requires `rpmbuild`. Build native Windows and macOS
packages on those operating systems for reliable, signed-ready output.

On Linux, the single-file AppImage is written to:

```text
out/make/AppImage/x64/Pathstone-0.3.0-x64.AppImage
```

Run it with:

```bash
chmod +x out/make/AppImage/x64/Pathstone-0.3.0-x64.AppImage
./out/make/AppImage/x64/Pathstone-0.3.0-x64.AppImage
```

Build requirements:

- Node.js **22.13 or newer** (Electron Forge 8).
- `mksquashfs` for the AppImage (`squashfs-tools` on Manjaro/Arch and
  Debian/Ubuntu).
- FUSE 2 to mount the AppImage normally. On systems without FUSE, run it with
  `--appimage-extract-and-run`.
- `dpkg-deb` + `fakeroot` add the `.deb` maker; `rpmbuild` adds the `.rpm`
  maker; `zip` adds portable zip output.
- Squirrel Windows installers build natively on Windows, or on Linux with
  `mono` and `wine`. DMG output requires macOS.

All generated files live under `out/` and are ignored by git. The packaging
script also warns if `out/` is not ignored in the current checkout.

The desktop database lives outside the app bundle:

| Platform | Database |
| --- | --- |
| Linux | `~/.config/pathstone/pathstone.db` |
| macOS | `~/Library/Application Support/pathstone/pathstone.db` |
| Windows | `%APPDATA%\pathstone\pathstone.db` |

On first run, if that file is empty, the app imports an existing
`data/pathstone.db` from the checkout (useful when running `npm run
desktop:start`). To import a database from elsewhere, point
`PATHSTONE_LEGACY_DB` at it for the first launch. `PATHSTONE_DB` overrides the
desktop database path for tests or portable setups.

The app is **unsigned**. AppImage, `.deb`, `.rpm`, Squirrel, `.dmg`, and zip
outputs are not code-signed or notarized; expect an OS warning on first
launch. App-level encryption is not included — use full-disk encryption if the
vault needs encryption at rest.

## Data & privacy

Three storage tiers, newest-wins at boot, fully on-device:

1. **SQLite file** — `data/pathstone.db` (created by the local server) or the
   desktop app's `pathstone.db` under Electron's userData directory:
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
- Clearing browser site data still deletes the browser tiers — export first.
  The desktop database lives in the app's userData directory, not in the
  browser profile.
- If storage is blocked, the save pill reads **Database unreachable** or
  **Storage unavailable** in plain words. It never pretends to save.

## Offline & install

A service worker (`sw.js`) serves same-origin requests offline and falls back
to the index shell on failed navigations. After one load with network, the
app installs itself for offline use and can be installed as an app through
the browser's install menu.

The Electron build is offline by construction: the renderer's HTTP/HTTPS/WS
requests are blocked, external navigation and popups are denied, and the
AppImage is a single executable file. The service worker is not registered
under `app://`; it is not needed there.

## Keyboard

| Key | Action |
| --- | --- |
| `Ctrl/⌘ + K` | Open the command palette |
| `Esc` | Close the current layer/overlay |
| `Enter` / `Space` | Open the focused task card, or select the focused calendar day |
| `Tab` inside modals | Focus is trapped inside the layer |

## Testing

The browser app has zero runtime dependencies and no build step. The optional
developer suite boots the real app in jsdom, exercises the real SQLite API,
and checks the embedded desktop database:

```bash
npm ci           # jsdom, fake-indexeddb, Electron, and Forge as dev deps
npm test         # 100 jsdom + 20 server API + 19 desktop SQLite assertions
```

CI runs the same command on every push and pull request via
`.github/workflows/tests.yml`. The desktop database test uses Node's built-in
`node:sqlite`; it skips cleanly on Node versions that do not ship it.

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
js/render.js          — chrome, Today, and Calendar rendering
js/views.js           — project page, board, palette, and list rendering
js/actions.js         — every user action (capture, move, complete, repeat…)
js/events.js          — init, bindings, keyboard, heartbeats, storage probe, boot
electron/main.js      — desktop shell: app:// protocol, security, window
electron/sqlite-service.js — embedded node:sqlite vault API for the desktop app
forge.config.js       — Electron Forge packaging (AppImage, deb, rpm, dmg, Squirrel, zip)
scripts/packaging.js  — maker matrix + host toolchain checks
scripts/package-desktop.js — cross-platform packaging wrapper
icons/                — app icons (PNG, ICO for Windows, ICNS for macOS)
out/                  — ignored build output (unpacked app and installers)
tests/                — jsdom suite + server API + desktop SQLite suites
.github/workflows/    — CI: the full suite on every push and pull request
```

## Contributing

Issues and focused pull requests are welcome.

- Keep the browser runtime dependency-free: no framework, no build step, no
  telemetry, no cloud sync. The desktop shell uses Electron plus Node
  built-ins only.
- Test-only packages belong in `devDependencies`; `npm ci && npm test` must
  pass from a clean checkout.
- Preserve the storage contract: embedded SQLite in the desktop app, SQLite
  when the local server is running, IndexedDB plus a localStorage mirror
  otherwise, newest-wins at boot.
- Match the existing code style; there is no linter or build pipeline to hide
  mistakes.

Open an issue before a large change. Behavior changes should come with a test
in `tests/test_pathstone.js` or `tests/test_server_api.js`.

## Known limits (by design)

- Single-user by design; syncing across devices is consciously postponed.
- Web notifications fire only while the tab is open — a browser platform
  limit, stated on the toggle itself.
- The browser app has no build pipeline, no telemetry, and no updates beyond
  the files here. Desktop packaging uses Electron Forge only.
- Desktop builds are unsigned. App-level encryption is not included; use
  full-disk encryption for a confidential vault.

## License

[MIT](LICENSE) © 2026 luel-4013
