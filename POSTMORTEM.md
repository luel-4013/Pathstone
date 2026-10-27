# Six-Month Failure Post-Mortem — Second Revision

*A reusable case study. Assume six months from now the product is dead. This is
the second autopsy of the same product: the first round of repairs shipped for
a healthy, namesake product; use it as a worked example with the blank template
at the end. Any product, any scale — the shape holds.*

---

## How to read this report

Every claim below carries one of four status words:

- **Fixed** — the code was changed and a passing test now proves it. If no test names it, it is not fixed.
- **Mitigated** — an honest patch is shipped; the *full* cure needs something this product cannot provide by itself.
- **Platform limit** — no app on the web can promise this today; it is documented so nobody promises it again.
- **Shelved (owner's call)** — the owner explicitly postponed it. It sits on the map, deliberately not in the code.

The one-paragraph story: *a local-first productivity workspace died twice in
its short life, for eleven reasons between them. Eight were fixed and locked
behind tests, one was a browser limit the product now promises around instead
of against, and two were shelved on purpose because a single-person tool
should stay a single-person tool for now.*

---

## The first death, in one paragraph

The product died the first time because the promises on the label were not in
the box: the "works offline" app had no offline mechanism at all, the progress
graphs were seeded fiction, the entire data store was one wrong click away
from amputation, and overdue tasks bounced to tomorrow forever — building a
treadmill of guilt with no arrival.

The first round of repairs shipped. Users came back. The tab stayed open —
and then the product died a **second** death.

---

## The second death certificate

*Recovered from the logs of the relaunch: five causes, in the order they
actually killed it.*

### 1. Midnight amnesia — the tab opened Tuesday never became Wednesday `Fixed`

The relaunch's best feature was the tab that stays open all day. Nobody tested
what happens across midnight: the day view kept showing yesterday — overdue
counters from last night, "due today" that was due two days ago. A day planner
that does not know the day changed is a screenshot. Users stopped trusting the
numbers.

**Fix:** a boot-day stamp checked on every heart-beat; on change the app
re-renders and toasts a short "new day" message. A unit test fakes yesterday
and proves the view rebuilds.

### 2. The undated backlog graveyard — the first fix cured guilt, then hid the work `Fixed`

The earlier fix that swept overdue tasks into an undated backlog removed the
guilt treadmill but introduced its own failure: swept tasks have no date and
no slot, so they stopped appearing wherever the user actually looks. Within a
month a graveyard of half-forgotten items grew underneath a peaceful surface.
Peace that hides debt is worse than the debt.

**Fix:** the daily plan check now counts undated backlog items and shows a
single quiet action that opens the list for triage — making the shelf visible
without making it loud.

### 3. Silent storage denial — the app that politely never saved `Fixed`

In strict browser contexts, storage access throws an error on *any* use. Every
write was wrapped in a "just keep going" handler, so the app ran normally —
capture, move, complete — and **nothing ever persisted**. No error, no banner.
The human found out a week later when the tab closed. A local-first product
that can lose everything silently on day one is gambling with its only asset:
trust.

**Fix:** a storage probe at startup and an honest banner (`Storage is
unavailable`) instead of pretending. Better unusable and honest than usable
and lying.

### 4. The import that owned the UI `Fixed`

Import was sold as "bring your file, we restore it". Imported values flowed
into visual style attributes with only weak checks — a hostile file could
rewrite parts of the interface. Every copy of the product ships an import
button; therefore every copy had the attack surface.

**Fix:** strict validation — imported colors must be real hex values or fall
back to known-safe ones, free-text labels are truncated, and unparseable
dates are dropped so the UI can never render nonsense like "NaN days old".

### 5. The reminders gap — a promise the web could not keep `Platform limit`

"Remind daily" implied a morning notification without opening the app. In
truth, web notifications from a server-less local app can only fire **while
the page is open**. The fix is not code — it is promising less: the toggle
says exactly what happens, and this report records that the stronger promise
belongs to the platform, not to the product.

---

## The fix ledger

| # | Cause | Repair site | Verified by | Status |
| --- | --- | --- | --- | --- |
| 1 | Midnight amnesia | day-view boot stamp + heartbeat check | test that fakes yesterday's boot | **Fixed** |
| 2 | Undated graveyard | daily plan-check counter + triage action | count + action-token test | **Fixed** |
| 3 | Silent storage denial | storage probe flag + honest save state | probe test + unavailable-UI test | **Fixed** |
| 4 | Import injection | strict validators for colors, labels, dates | hostile vs. legit value tests | **Fixed** |
| 5 | Reminder expectation gap | honest copy + documented platform ceiling | copy asserted in suite | **Platform limit** (mitigated) |

The test suite grew with every fix; each ledger row lists the test that
proves it. Every module passes a basic syntax check before the suite runs.

---

## What can still kill it — the honest list, with status

1. **No multi-device story — Shelved (owner's call: "not yet").**
   The data lives only in this browser on this device; clearing browser data
   deletes it, and manual export is a fire drill, not a strategy. Watch-file:
   if a second device becomes part of the routine, this jumps to the top.

2. **Reminder ceiling — Platform limit (mitigated).**
   The web cannot push an alarm from a closed tab for a server-less app. The
   product promises *around* it: honest wording, plus a recap the moment the
   app opens. Until a push transport exists, mornings belong to real alarm
   and calendar apps. Nothing more can or should be promised.

3. **Touch drag — Mitigated, deeper fix shelved.**
   Phone browsers do not support desktop-style dragging. What ships instead:
   tap an item, open its editor, move it from there. The bridge holds for
   now; drive slowly.

4. **Sample-data residue — Fixed in practice, guarded continuously.**
   Demo data is clearly badged, one click wipes it, and first-run asks
   demo-or-empty with real answers. The small honest residue: someone who
   keeps the sample for weeks blends sample wins with real ones — the badge
   keeps that visible every day. That is the guard working; keep it on.

5. **One owner, forever — Shelved (owner's call: "not now").**
   Every assumption is single-player: one name, "my" items, no sharing, no
   conflict handling. That is the right shape for a personal tool. The day a
   second person joins, almost every data model and line of copy is affected
   at once — this file should be reopened then, not before.

*End of report. What is true now that was not true before: the data is local
and honest, the day renews itself at midnight, the backlog is visible, storage
tells the truth, imports are locked down, and two doors were closed on
purpose. If it dies again, let it be of something new.*

---

## Appendix A — plain-English glossary

- **Local-first** — all data lives on the user's own device, inside their own browser. No account needed, and nothing to lose to a shutdown notice.
- **Service worker** — a small background script that lets a web page keep working with no internet. Makes "works offline" a real promise instead of a slogan.
- **Storage denial** — when a browser refuses the page permission to save anything. Can happen silently in strict contexts; the app must detect it and say so.
- **Import injection** — a hostile data file smuggling instructions into the interface through unchecked values. Stopped by validating every imported value's *shape* before display.
- **Platform limit** — something browser makers do not allow any web app to do, no matter how good the app is.
- **Shelved** — a known gap, documented and deliberately postponed by the owner. A shelf is visible by design; that is the point.

## Appendix B — reusable post-mortem template

Copy this shape for the next failure — any product, any scale:

1. **The death certificate.** List causes in the order they killed, newest first. Bold the mechanism in one sentence — no hedging.
2. **Status tag per cause.** `Fixed` / `Mitigated` / `Platform limit` / `Shelved (owner's call)`. If it is Fixed, name the test that proves it; otherwise it is not fixed.
3. **The fix ledger.** One table row per cause: repair site, verification, status.
4. **What can still kill it.** Residual risks with honest status tags and a "watch-file" note naming the signal that should reopen each item.
5. **Glossary.** Every term a non-technical teammate would trip on, defined in one line.
6. **The closing rule.** End with what is now true that was not true before — and invite the next death to be of something new.
