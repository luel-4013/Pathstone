'use strict';

/* Unit/integration test for the Electron main-process database service.
 *
 * This exercises the same handle() surface that electron/main.js uses for
 * /api/vault and /api/snapshots, including restart persistence and first-run
 * import from the browser/server database. It runs on the system Node because
 * `node:sqlite` ships with modern Node; if this Node is too old the suite
 * skips instead of failing the browser tests.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (error) {
  console.log('  · node:sqlite unavailable on this Node — desktop database test skipped');
  process.exit(0);
}

const { VaultService, ApiError } = require('../electron/sqlite-service');

const passes = [];
const failures = [];
const t = (name, condition) => {
  if (condition) passes.push(name);
  else failures.push(name);
  console.log((condition ? '  ✓ ' : '  ✗ ') + name);
};

const quiet = { info() {}, warn() {}, error() {} };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pathstone-sqlite-'));
const dbPath = path.join(root, 'pathstone.db');
const legacyPath = path.join(root, 'legacy.db');

function cleanup() {
  fs.rmSync(root, { recursive: true, force: true });
}

function makeLegacyDb() {
  const db = new DatabaseSync(legacyPath);
  db.exec(`
    CREATE TABLE vault (id TEXT PRIMARY KEY, saved_at TEXT NOT NULL, json TEXT NOT NULL);
    CREATE TABLE snapshots (id TEXT PRIMARY KEY, kind TEXT NOT NULL, saved_at TEXT NOT NULL, json TEXT NOT NULL);
  `);
  db.prepare("INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)").run(
    '2026-10-01T09:00:00.000Z',
    JSON.stringify({ tasks: [{ id: 'legacy-task', title: 'from the old database' }] })
  );
  db.prepare('INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)').run(
    'snap-legacy-1',
    'manual',
    '2026-10-01T09:05:00.000Z',
    JSON.stringify({ tasks: [{ id: 'legacy-task', title: 'snapshot copy' }] })
  );
  db.close();
}

try {
  if (!fs.existsSync(dbPath)) {
    const service = new VaultService(dbPath, { logger: quiet });

    let result = service.handle('GET', '/api/vault');
    t('empty database returns a null vault record', result.status === 200 && result.payload.record === null);

    const firstState = { tasks: [{ id: 't1', title: 'persist me' }], version: 1 };
    result = service.handle('PUT', '/api/vault', { state: firstState, savedAt: '2026-11-15T12:00:00.000Z' });
    t('vault write returns the savedAt', result.payload.savedAt === '2026-11-15T12:00:00.000Z');

    result = service.handle('GET', '/api/vault');
    t('vault read returns the exact state', JSON.stringify(result.payload.record.state) === JSON.stringify(firstState));
    t('vault read returns the timestamp', result.payload.record.savedAt === '2026-11-15T12:00:00.000Z');

    let threw = false;
    try {
      service.handle('PUT', '/api/vault', { savedAt: 'now' });
    } catch (error) {
      threw = error instanceof ApiError && error.status === 400;
    }
    t('vault rejects a body without state', threw);

    result = service.handle('POST', '/api/snapshots', {
      id: 'snap-auto-1',
      kind: 'auto',
      savedAt: '2026-11-15T12:01:00.000Z',
      state: { tasks: [{ id: 't1', title: 'snapshot' }] },
    });
    t('snapshot write returns the id', result.payload.id === 'snap-auto-1');

    result = service.handle('GET', '/api/snapshots');
    t('snapshot list contains the snapshot', result.payload.records.some((snap) => snap.id === 'snap-auto-1'));

    result = service.handle('GET', '/api/snapshots/snap-auto-1');
    t('snapshot read returns the exact state', result.payload.record.state.tasks[0].title === 'snapshot');

    result = service.handle('GET', '/api/snapshots/missing');
    t('unknown snapshot returns a null record', result.status === 200 && result.payload.record === null);

    threw = false;
    try {
      service.handle('DELETE', '/api/snapshots/snap%2Fbad');
    } catch (error) {
      threw = error instanceof ApiError && error.status === 400;
    }
    t('hostile snapshot id is rejected', threw);

    threw = false;
    try {
      service.handle('POST', '/api/snapshots', { id: 'x', kind: 'bad', state: {} });
    } catch (error) {
      threw = error instanceof ApiError && error.status === 400;
    }
    t('unknown snapshot kind is rejected', threw);

    threw = false;
    try {
      service.handle('PATCH', '/api/vault');
    } catch (error) {
      threw = error instanceof ApiError && error.status === 405;
    }
    t('unsupported method is rejected with 405', threw);

    threw = false;
    try {
      service.handle('GET', '/api/wat');
    } catch (error) {
      threw = error instanceof ApiError && error.status === 404;
    }
    t('unknown API route is rejected with 404', threw);

    result = service.handle('DELETE', '/api/snapshots/snap-auto-1');
    t('snapshot delete reports success', result.payload.deleted === true);
    result = service.handle('GET', '/api/snapshots/snap-auto-1');
    t('deleted snapshot is gone', result.payload.record === null);

    service.close();

    const reopened = new VaultService(dbPath, { logger: quiet });
    result = reopened.handle('GET', '/api/vault');
    t(
      'vault survives a full service restart',
      result.payload.record && result.payload.record.state.tasks[0].title === 'persist me'
    );
    reopened.close();
  }

  makeLegacyDb();
  const freshPath = path.join(root, 'fresh.db');
  const migrated = new VaultService(freshPath, { legacyPath, logger: quiet });
  let result = migrated.handle('GET', '/api/vault');
  t(
    'first run imports the legacy vault',
    result.payload.record && result.payload.record.state.tasks[0].id === 'legacy-task'
  );
  result = migrated.handle('GET', '/api/snapshots/snap-legacy-1');
  t(
    'first run imports legacy snapshots',
    result.payload.record && result.payload.record.state.tasks[0].title === 'snapshot copy'
  );
  migrated.close();

  const again = new VaultService(freshPath, { legacyPath, logger: quiet });
  result = again.handle('GET', '/api/vault');
  t(
    'later runs do not overwrite the desktop database',
    result.payload.record.state.tasks[0].id === 'legacy-task'
  );
  again.close();
} catch (error) {
  console.error('UNEXPECTED:', error);
  failures.push(`unexpected: ${error.message}`);
} finally {
  cleanup();
}

console.log(`\nPASSED: ${passes.length}\nFAILED: ${failures.length}`);
if (failures.length) console.log('  ✗ ' + failures.join('\n  ✗ '));
process.exit(failures.length ? 1 : 0);
