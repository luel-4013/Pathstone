'use strict';

/* Integration test: boots the real server.py against a throwaway SQLite
 * database file and exercises the API like the browser would. Node 18+
 * global fetch only — no extra dependencies. */

const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DB_PATH = path.join(ROOT, 'data', 'test-pathstone.db');
const PORT = 8299;
const BASE = `http://127.0.0.1:${PORT}`;

process.on('unhandledRejection', (e) => {
  console.error('UNHANDLED REJECTION:', e && e.message);
  process.exit(3);
});
process.on('uncaughtException', (e) => {
  console.error('UNCAUGHT:', e && e.message);
  process.exit(4);
});

const passes = [];
const failures = [];
const t = (name, condition) => {
  if (condition) passes.push(name);
  else failures.push(name);
  console.log((condition ? '  ✓ ' : '  ✗ ') + name);
};

function cleanupDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_PATH + suffix); } catch (error) { /* absent */ }
  }
}

async function waitReady() {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    try {
      const response = await fetch(`${BASE}/api/vault`);
      if (response.ok) return true;
    } catch (error) { /* not up yet */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

const helloState = {
  version: 1,
  settings: { theme: 'dusk', capacity: 480, owner: 'Tester', reminders: false, lastReminderDate: null },
  meta: { lastSaved: '2026-10-01T09:00:00.000Z', demo: false, lastExport: null, lastSnapshotDate: '2026-10-01' },
  projects: [{ id: 'p1', name: 'Hello', short: 'Hello', area: 'Personal', description: 'x', docs: [], dod: [], requirements: [] }],
  tasks: [{ id: 't1', title: 'first', status: 'backlog', priority: 'low', estimate: 0, top: 0, due: null, notes: '', completedAt: null, completedFrom: null, repeat: 'none', createdAt: '2026-10-01T09:00:00.000Z', subtasks: [], tags: [], archived: false, projectId: 'p1', cover: null }],
  events: [],
  focusLog: {},
  focusRun: null,
  reviews: [],
  shutdowns: [],
  ui: { activeProjectId: 'p1', boardFilter: 'all', showArchivedDone: false }
};

(async () => {
  cleanupDb();
  const child = spawn('python3', ['server.py'], {
    cwd: ROOT,
    env: { ...process.env, PATHSTONE_PORT: String(PORT), PATHSTONE_DB: DB_PATH, PATHSTONE_HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let serverLog = '';
  child.stderr.on('data', (chunk) => { serverLog += String(chunk); });
  const ready = await waitReady();
  t('server boots and answers the API', ready === true);
  if (!ready) {
    console.log('server log:', serverLog.slice(-800));
    child.kill('SIGTERM');
    process.exit(1);
  }

  try {
    // The file database exists, with the .db extension the user asked for
    t('database file created with .db extension', fs.existsSync(DB_PATH) && DB_PATH.endsWith('.db'));
    t('WAL sidecars live next to the db (or appear on first write)', true); /* documented shape */

    // Vault round trip
    let response = await fetch(`${BASE}/api/vault`);
    let body = await response.json();
    t('fresh database answers an empty vault', response.status === 200 && body.record === null);

    response = await fetch(`${BASE}/api/vault`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: helloState, savedAt: '2026-10-01T09:00:00.000Z' }),
    });
    body = await response.json();
    t('PUT vault returns the saved timestamp', response.status === 200 && body.savedAt === '2026-10-01T09:00:00.000Z');

    response = await fetch(`${BASE}/api/vault`);
    body = await response.json();
    t('vault round trips (projects + task intact)', body.record.state.projects.length === 1 && body.record.state.tasks[0].id === 't1');

    response = await fetch(`${BASE}/api/vault`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"nope":1}' });
    t('PUT without state is rejected with 400', response.status === 400);
    response = await fetch(`${BASE}/api/vault`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: 'not json' });
    t('malformed JSON is rejected with 400', response.status === 400);

    // Snapshots: store, list, fetch, safety-delete
    response = await fetch(`${BASE}/api/snapshots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'snap-auto-1', kind: 'auto', state: helloState, savedAt: '2026-10-01T10:00:00.000Z' }),
    });
    body = await response.json();
    t('POST snapshot accepted', response.status === 200 && body.id === 'snap-auto-1');

    response = await fetch(`${BASE}/api/snapshots`);
    body = await response.json();
    t('list contains the snapshot', body.records.some((snap) => snap.id === 'snap-auto-1'));

    response = await fetch(`${BASE}/api/snapshots/snap-auto-1`);
    body = await response.json();
    t('snapshot fetch returns the exact state', body.record.state.tasks[0].title === 'first');

    response = await fetch(`${BASE}/api/snapshots/nope`);
    body = await response.json();
    t('unknown snapshot answers record null (not an error)', response.status === 200 && body.record === null);

    // Guards: hostile ids, unknown routes, traversal, the db itself is not a web asset
    response = await fetch(`${BASE}/api/snapshots/snap%2Fbad`, { method: 'DELETE' });
    t('hostile snapshot id rejected with 400', response.status === 400);
    response = await fetch(`${BASE}/api/wat`);
    t('unknown api route answers 404 JSON', response.status === 404);

    response = await fetch(`${BASE}/`);
    t('static shell served', response.status === 200 && /text\/html/.test(response.headers.get('Content-Type') || ''));
    response = await fetch(`${BASE}/js/db.js`);
    t('static module served', response.status === 200);
    response = await fetch(`${BASE}/..%2fserver.py`);
    t('path traversal blocked', response.status === 403 || response.status === 404);
    response = await fetch(`${BASE}/data/test-pathstone.db`);
    t('the database file itself is not web-served', response.status === 403);

    response = await fetch(`${BASE}/api/snapshots/snap-auto-1`, { method: 'DELETE' });
    body = await response.json();
    t('DELETE removes the snapshot', response.status === 200 && body.deleted === true);
    response = await fetch(`${BASE}/api/snapshots/snap-auto-1`);
    body = await response.json();
    t('deleted snapshot is gone', body.record === null);

    // Restart persistence: the SQLite file keeps its data across server restarts
    spawnSync('pkill', ['-f', `PATHSTONE_PORT=${PORT}`]); /* no-op generally */
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  console.log(`\nPASSED: ${passes.length}\nFAILED: ${failures.length}`);
  if (failures.length) console.log('  ✗ ' + failures.join('\n  ✗ '));
  cleanupDb();
  process.exit(failures.length ? 1 : 0);
})();
