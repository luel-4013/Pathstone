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

Serving over HTTP is required (`file://` can silently block storage in some
browsers). Any static file server works:

```bash
python3 -m http.server 8247 --bind 127.0.0.1
# or: npx serve .
# or: caddy file-server --listen :8247
```

Then open `http://127.0.0.1:8247`. First run asks: explore the demo, or start
empty.

If storage is not available in your browser context, the save pill says
**Storage unavailable** in plain words — the app will not pretend to save.

## Data & privacy

- Everything lives in `localStorage` under the key `pathstone-vault-v1`.
- **Export / Import** your whole vault as a JSON file from the vault card.
  Export is also the backup story: the card nudges you when the last backup
  is ~two weeks old.
- Clearing the browser's site data deletes the vault — export first.
- No network calls beyond the initial file load; there is no server.

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
npm install      # installs jsdom as a dev dependency only
npm test         # runs the full assertion suite
```

Notes on the harness live in `tests/test_pathstone.js` — including the two
classic pitfalls it guards against (script inlining order, and `$`-escaping
when injecting code via `String.replace`).

## Project structure

```
index.html            — the single page (all views/overlays live here)
styles.css            — the whole visual system
manifest.webmanifest  — PWA install metadata
sw.js                 — offline cache (stale-while-revalidate + shell fallback)
js/core.js            — state helpers, time math, plan check, themes
js/seed.js            — seed data, blank-vault factory, import validation
js/render.js          — chrome + dashboard rendering
js/views.js           — lists, board, palette, week views
js/actions.js         — every user action (capture, move, complete, repeat…)
js/events.js          — init, bindings, keyboard, heartbeats, storage probe
tests/                — optional jsdom suite (npm test)
```

## Documentation

- `POSTMORTEM.md` — a reusable six-month failure post-mortem: how the product
  died twice in testing, what was fixed and proven, what was consciously
  shelved, and the blank template for running the same autopsy on anything.

## Known limits (by design)

- Single-user by design; syncing across devices is consciously postponed.
- Web notifications fire only while the tab is open — a browser platform
  limit, stated on the toggle itself.
- There is no build pipeline, no telemetry, no updates beyond the files here.

## License

[MIT](LICENSE) © 2026 luel-4013
