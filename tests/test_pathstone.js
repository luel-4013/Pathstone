'use strict';

const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e && e.name, e && e.message);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(3);
});
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e && e.name, e && e.message);
  if (e && e.stack) console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(4);
});
const failures = [];
const passes = [];
const t = (name, condition) => {
  if (condition) { passes.push(name); } else { failures.push(name); }
  console.log((condition ? '  ✓ ' : '  ✗ ') + name);
};

(async () => {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  vc.on('error', (...args) => errors.push(args.join(' ')));

  // Inline the modules (document order preserved) so the harness has no
  // network dependency. `$` must be escaped in replacement strings or
  // `const $$` gets mangled into `const $` by String.replace.
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const name of ['core', 'seed', 'render', 'views', 'actions', 'events']) {
    const source = fs.readFileSync(path.join(ROOT, 'js', `${name}.js`), 'utf8');
    const escaped = source.replace(/\$/g, '$$$$');
    html = html.replace(`<script src="js/${name}.js" defer></script>`, `<script>${escaped}</script>`);
  }

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/index.html',
    virtualConsole: vc,
    beforeParse(window) {
      window.confirm = () => true;
      window.alert = () => {};
      if (!window.URL.createObjectURL) window.URL.createObjectURL = () => 'blob:mock-url';
      if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = () => {};
      window.__notes = [];
      window.Notification = Object.assign(function MockNotification(title, options) {
        window.__notes.push({ title, options });
      }, { permission: 'granted', requestPermission: () => Promise.resolve('granted') });
    }
  });

  const { window } = dom;
  const { document } = window;
  // `state` is a top-level `let`, so it is not a window property; reach it via eval.
  const S = (expr) => window.eval(expr);

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };
    if (S('typeof state') !== 'undefined') return finish();
    window.addEventListener('load', () => window.setTimeout(finish, 900));
    window.setTimeout(finish, 6000);
  });
  await new Promise((r) => window.setTimeout(r, 250));

  t('app booted (state exists)', S('typeof state') === 'object');
  const todayKey = S('todayKey()');
  const addDays = (key, n) => S(`addDays(${JSON.stringify(key)}, ${n})`);
  const daysBetween = (a, b) => S(`daysBetween(${JSON.stringify(a)}, ${JSON.stringify(b)})`);

  t('seed loaded 4 projects', S('state.projects.length') === 4);
  t('top three renders 3 rows', document.querySelectorAll('#topThree .task-row').length === 3);
  t('board renders 5 columns', document.querySelectorAll('#board .board-col').length === 5);

  // First-run choice appears on a fresh (no vault) browser — must be asserted
  // before any test opens another layer (openLayer closes all others).
  t('first-run modal opens on fresh boot', document.getElementById('firstRunModal').hidden === false);
  t('demo badge visible on fresh boot', document.getElementById('demoBadge').hidden === false);
  t('seed marks vault as demo', S('state.meta.demo') === true);
  t('demo reset button visible while demo', document.getElementById('demoResetBtn').hidden === false);
  S(`closeLayers()`);

  t('focus goal text set from constant', document.getElementById('focusGoal').textContent.includes('15h'));

  const futureKeys = S('Object.keys(state.focusLog)').filter((key) => daysBetween(todayKey, key) > 0);
  t('seeded focus log has no future days', futureKeys.length === 0);

  // Capture flow
  const captureInput = document.getElementById('captureInput');
  captureInput.value = 'Buy oat milk';
  document.getElementById('captureForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  const captured = S(`state.tasks.find((task) => task.title === 'Buy oat milk')`);
  t('capture lands in inbox', Boolean(captured) && captured.status === 'inbox');
  t('capture input cleared', captureInput.value === '');
  t('repeat defaults to none on capture', Boolean(captured) && captured.repeat === 'none');

  // Repeat spawn + focus log on completion
  const beforeCount = S('state.tasks.length');
  const beforeBadge = Number(S('Number(state.focusLog["' + todayKey + '"]) || 0'));
  const spawn = S(`(function(){ const task = state.tasks.find((t) => t.id === 't-demo'); task.repeat = 'daily'; const estimate = task.estimate; const spawn = completeTask(task, 'test'); return { spawn, estimate }; })()`);
  t('completeTask reports spawn', spawn.spawn === true);
  t('repeat clone created with tomorrow due', S('state.tasks.length') === beforeCount + 1
    && S('state.tasks[state.tasks.length - 1].status') === 'backlog'
    && S('state.tasks[state.tasks.length - 1].due') === addDays(todayKey, 1)
    && S('state.tasks[state.tasks.length - 1].id') !== 't-demo');
  t('completed task slot cleared and status done', S('state.tasks.find((t) => t.id === "t-demo") && state.tasks.find((t) => t.id === "t-demo").status') === 'done'
    && S('state.tasks.find((t) => t.id === "t-demo").top') === 0);
  t('focus log grows by estimate on completion', Number(S('Number(state.focusLog["' + todayKey + '"]) || 0')) === beforeBadge + spawn.estimate);

  // Editing an archived done task must not silently unarchive it
  t('seed has an archived done task', S('state.tasks.some((t) => t.id === "t-archive-0" && t.archived)') === true);
  S(`openTask('t-archive-0')`);
  document.getElementById('taskNotes').value = 'audit check';
  S('saveTask()');
  t('editing archived task preserves archived flag', S('state.tasks.find((t) => t.id === "t-archive-0").archived') === true);
  t('edit modal closed after save', document.getElementById('taskModal').hidden);

  // Modal round-trips the repeat value
  S(`openTask('t-demo')`);
  t('modal prefills repeat', document.getElementById('taskRepeat').value === 'daily');
  S('closeLayers()');

  // Pin toast: resolved slot instead of "0next" (slot 3 freed by completing t-demo)
  S(`pinTask('t-analytics', 'next')`);
  const toastText = document.getElementById('toast').textContent;
  t('pin resolves to a real slot number', /priority 0[1-3]/.test(toastText) || toastText.includes('Unpin one first'));
  t('toast never says "0next"', !toastText.includes('0next'));

  // Occupied-slot semantics
  const result = S(`(function(){ const first = topTasks()[0]; return { id: first.id, moved: moveTaskToTop(first.id, 1), dup: topTasks().filter((x) => x.top === 1).length }; })()`);
  t('moving occupied slot bumps holder and returns slot', result.moved === 1 && result.dup === 1);

  // normalizeState hardening
  const hardened = S(`normalizeState({ projects: [{ id: 'p1' }], tasks: [{ id: 'tk', title: 'T', completedAt: 'not-a-date', createdAt: '2026-01-01T00:00:00Z', repeat: 'banana', top: 9 }] })`).tasks[0];
  t('invalid completedAt dropped', hardened.completedAt === null);
  t('invalid repeat coerced to none', hardened.repeat === 'none');
  t('top clamped to 3', hardened.top === 3);

  // Export metadata + vault note
  S('exportData()');
  t('export stamps lastExport', Boolean(S('state.meta.lastExport')));
  const vaultNote = document.getElementById('vaultExport').textContent;
  t('vault note shows recent backup', vaultNote.includes('recent copy exists') || vaultNote.includes('Backup exported'));

  // Palette renders
  S(`openPalette('search')`);
  t('palette results render', document.querySelectorAll('#paletteResults .palette-result').length > 0);
  S('closeLayers()');

  t('task modal has repeat select', Boolean(document.getElementById('taskRepeat')));

  // Static check: every static $('#id') referenced by JS exists in the DOM
  const js = ['core', 'seed', 'render', 'views', 'actions', 'events']
    .map((name) => fs.readFileSync(path.join(ROOT, 'js', `${name}.js`), 'utf8'))
    .join('\n');
  const ids = new Set();
  const re = /\$\('#([A-Za-z0-9_-]+)'\)/g;
  let match;
  while ((match = re.exec(js))) ids.add(match[1]);
  const missing = Array.from(ids).filter((id) => !document.getElementById(id));
  t(`all static selectors resolve in DOM (missing: ${missing.join(', ') || 'none'})`, missing.length === 0);

  // Offline artifacts
  t('service worker file exists', fs.existsSync(path.join(ROOT, 'sw.js')));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  t('manifest references icons that exist', manifest.icons.every((icon) => fs.existsSync(path.join(ROOT, icon.src))));

  // ---- Round-2 features: sweeps, workday window, reminders, first-run, focus timer ----

  // Overdue sweep undates instead of postponing forever (demo state, tasks present)
  const sweep = S(`(function(){ const overdue = overdueTasks(); const before = overdue.length; rescheduleOverdue(); return { before, count: overdueTasks().length, undated: overdue.filter((t) => !t.due && !t.top).length }; })()`);
  t('sweep clears overdue tasks to backlog (undated)', sweep.before > 0 && sweep.count === 0 && sweep.undated === sweep.before);

  // Swept tasks must not become invisible: plan check counts undated backlog
  // and offers a "Decide" action that opens the task palette.
  const backlog = S(`(function(){ const plan = computePlan(); renderPlan(); const decide = document.querySelector('.plan-suggestion [data-action="open-palette"][data-mode="tasks"]'); return { undated: plan.backlogUndated, decide: Boolean(decide), label: decide ? decide.textContent : '' }; })()`);
  t('swept tasks counted as undated backlog', backlog.undated >= sweep.before);
  t('plan check offers Decide for undated backlog', backlog.decide && backlog.label === 'Decide');

  // Workday-aware plan check (closed after 17:00 local)
  const closedNow = new Date().getHours() >= 17;
  const planMoves = S('computePlan().moves');
  t('plan check knows when the workday is closed', S('computePlan().closed') === closedNow && (!closedNow || planMoves === 0));

  // Reminders: mock Notification service (demo state has counts to report)
  const remindResult = S(`(function(){ const before = Boolean(state.settings.reminders); toggleReminders(); const after = state.settings.reminders; runDailyReminder(); return { before, after, last: state.settings.lastReminderDate, notified: window.__notes.length }; })()`);
  t('reminders enable with granted permission', remindResult.before === false && remindResult.after === true);
  t('daily reminder protects against re-firing', remindResult.last === todayKey);
  t('reminder notification texts mention counts', /overdue|due today|priorit/.test(remindResult.notified ? window.__notes[0].options.body : ''));
  t('reminder button keeps its icon and span label', Boolean(document.querySelector('#remindBtn svg')) && document.querySelector('#remindBtn span').textContent === 'Reminders on');
  const remindOff = S(`(function(){ const notesBefore = window.__notes.length; toggleReminders(); state.settings.lastReminderDate = null; runDailyReminder(); return { on: state.settings.reminders, notesAfter: window.__notes.length }; })()`);
  t('reminders off stops notifications', remindOff.on === false && remindOff.notesAfter === remindResult.notified);

  // First-run actions (real click path) — run after sweeps/reminders so demo data exists above
  document.querySelector('#firstRunModal [data-action="first-run-empty"]').click();
  t('first-run empty clears projects/tasks', S('state.projects.length') === 0 && S('state.tasks.length') === 0);
  t('empty vault is not demo', S('state.meta.demo') === false);
  t('empty state titled "Pathstone"', document.getElementById('workspaceTitle').textContent === 'Pathstone');
  t('empty vault persisted', JSON.parse(window.localStorage.getItem('pathstone-vault-v1')).projects.length === 0);
  t('empty vault note reset to no-backup', document.getElementById('vaultExport').textContent.includes('No backup yet'));
  t('demo badge hidden after empty start', document.getElementById('demoBadge').hidden === true);

  // normalizeState drops invalid focusRun and keeps valid one; demo flag not inherited from seed base
  S(`startDemoWorkspace()`);
  t('demo flag persists through save', JSON.parse(window.localStorage.getItem('pathstone-vault-v1')).meta.demo === true);
  const runNorm = S(`normalizeState({
    projects: [{ id: 'p1' }], tasks: [],
    focusRun: { startedAt: 'bad-date' },
    meta: {}
  })`);
  t('invalid focusRun dropped', runNorm.focusRun === null);
  t('demo flag defaults false for old vaults (not inherited from seed)', runNorm.meta.demo === false);
  const runNormOk = S(`normalizeState({
    projects: [{ id: 'p1' }], tasks: [],
    focusRun: { startedAt: '2026-10-27T10:00:00.000Z' }
  })`);
  t('valid focusRun kept', runNormOk.focusRun && runNormOk.focusRun.startedAt === '2026-10-27T10:00:00.000Z');

  // Import hardening: lastExport, project color, cover colors
  const exportNorm = S(`normalizeState({ projects: [{ id: 'p1' }], tasks: [], meta: { lastExport: 'not-a-date' } })`);
  t('invalid lastExport cleared to null', exportNorm.meta.lastExport === null);
  const unsafeNorm = S(`normalizeState({
    projects: [{ id: 'p1', color: '"><script>alert(1)</script>' }],
    tasks: [{ id: 't1', title: 'x', cover: { label: '<b>bad</b>', c1: 'url(javascript:x)', c2: 'red;' } }]
  })`);
  t('hostile project color coerced to safe hex', unsafeNorm.projects[0].color === '#e08a6b');
  t('hostile cover colors coerced to safe hex', unsafeNorm.tasks[0].cover.c1 === '#d97757' && unsafeNorm.tasks[0].cover.c2 === '#e8ad8f');
  const safeNorm = S(`normalizeState({
    projects: [{ id: 'p1', color: '#8fc3a3' }],
    tasks: [{ id: 't1', title: 'x', cover: { label: 'OK', c1: '#6f88bb' } }]
  })`);
  t('legit colors preserved (c2 default when missing)', safeNorm.projects[0].color === '#8fc3a3' && safeNorm.tasks[0].cover.c2 === '#e8ad8f');

  // Focus timer: start -> stop logs minutes into today's focus log
  const focusBefore = S(`Number(state.focusLog["${todayKey}"]) || 0`);
  S(`startFocus()`);
  t('focus run starts', Boolean(S('state.focusRun && state.focusRun.startedAt')));
  t('button flips to Stop focus', document.getElementById('focusRunLabel').textContent === 'Stop focus');
  t('clock ticks while running', document.getElementById('focusClock').textContent !== '—');
  S(`state.focusRun.startedAt = new Date(Date.now() - 42 * 60000).toISOString()`);
  S(`stopFocus()`);
  t('focus run cleared after stop', S('state.focusRun') === null);
  t('elapsed focus minutes logged', Number(S(`Number(state.focusLog["${todayKey}"]) || 0`)) === focusBefore + 42);
  const zeroStop = S(`(function(){ startFocus(); stopFocus(); return { toast: document.querySelector('#toast').textContent, run: state.focusRun }; })()`);
  t('sub-minute focus not logged', zeroStop.run === null && /under a minute/.test(zeroStop.toast));

  // Midnight rollover: a tab left open across 00:00 must not keep yesterday's view
  const rollover = S(`(function(){
    dayBooted = '2000-01-01';
    const before = document.getElementById('toast').textContent;
    const changed = checkDayRollover();
    return { changed, booted: dayBooted === todayKey(), after: document.getElementById('toast').textContent, before };
  })()`);
  t('midnight rollover restarts the day view', rollover.changed && rollover.booted && rollover.after !== rollover.before && /new day/.test(rollover.after));
  t('rollover is a no-op within the same day', S(`(function(){ const boot = dayBooted; const toastBefore = document.getElementById('toast').textContent; const changed = checkDayRollover(); return { changed, boot, toastBefore, after: document.getElementById('toast').textContent }; })()`).changed === false);

  const realErrors = errors.filter((line) => !/navigation|Could not load|Not implemented/i.test(line));
  t(`no runtime errors (${realErrors.length})`, realErrors.length === 0);

  console.log(`\nPASSED: ${passes.length}\nFAILED: ${failures.length}`);
  if (passes.length) console.log('  ✓ ' + passes.join('\n  ✓ '));
  if (failures.length) console.log('  ✗ ' + failures.join('\n  ✗ '));
  if (realErrors.length) console.log('errors:', realErrors.join('\n'));
  process.exit(failures.length ? 1 : 0);
})().catch((error) => {
  console.error('TEST CRASH:', error);
  process.exit(2);
});
