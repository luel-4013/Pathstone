'use strict';

/*
 * Embedded Pathstone vault storage for the Electron shell.
 *
 * This is the desktop equivalent of server.py's SQLite layer: the same
 * tables, the same JSON records, and the same /api/vault + /api/snapshots
 * contract. It uses Node's built-in `node:sqlite` module, so the packaged
 * app stays self-contained — no Python, no sidecar process, no network
 * listener, and no data outside the app's userData directory.
 */

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const MAX_BODY = 32 * 1024 * 1024;
const SAFE_ID = /^[A-Za-z0-9._:-]{1,120}$/;
const SAFE_KINDS = new Set(['auto', 'manual', 'pre']);

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS vault (
    id TEXT PRIMARY KEY,
    saved_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS snapshots (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    saved_at TEXT NOT NULL,
    json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_snapshots_saved ON snapshots(saved_at);
`;

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeSavedAt(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 40 ? value : nowIso();
}

function parseState(text) {
  const state = JSON.parse(text);
  if (!isPlainObject(state)) throw new Error('state is not an object');
  return state;
}

class VaultService {
  constructor(dbPath, options = {}) {
    if (!dbPath) throw new Error('a database path is required');

    this.dbPath = path.resolve(dbPath);
    this.legacyPath = options.legacyPath ? path.resolve(options.legacyPath) : null;
    this.logger = options.logger || console;

    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

    this.db = new DatabaseSync(this.dbPath, { timeout: 5000 });
    this.db.exec('PRAGMA journal_mode=WAL');
    this.db.exec('PRAGMA busy_timeout=3000');
    this.db.exec(SCHEMA);

    this.migrateLegacy();
  }

  close() {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }

  /* ---- first-run migration from the browser/server database ---- */

  migrateLegacy() {
    if (!this.legacyPath || this.legacyPath === this.dbPath) return;
    if (!fs.existsSync(this.legacyPath)) return;

    const vaultCount = this.db.prepare('SELECT COUNT(*) AS n FROM vault').get().n;
    const snapshotCount = this.db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n;
    if (Number(vaultCount) > 0 || Number(snapshotCount) > 0) return;

    let legacy = null;
    try {
      legacy = new DatabaseSync(this.legacyPath, { timeout: 5000 });
      legacy.exec('PRAGMA query_only=ON');

      const tables = new Set(
        legacy
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all()
          .map((row) => row.name)
      );

      let vault = null;
      if (tables.has('vault')) {
        const row = legacy.prepare("SELECT saved_at, json FROM vault WHERE id = 'current'").get();
        if (row) {
          try {
            vault = { savedAt: row.saved_at, state: parseState(row.json) };
          } catch {
            this.logger.warn('[vault] skipping unreadable legacy vault row');
          }
        }
      }

      const snapshots = [];
      if (tables.has('snapshots')) {
        for (const row of legacy.prepare('SELECT id, kind, saved_at, json FROM snapshots').all()) {
          try {
            if (!SAFE_ID.test(String(row.id)) || !SAFE_KINDS.has(String(row.kind))) continue;
            snapshots.push({
              id: String(row.id),
              kind: String(row.kind),
              savedAt: String(row.saved_at),
              state: parseState(row.json),
            });
          } catch {
            this.logger.warn('[vault] skipping unreadable legacy snapshot row');
          }
        }
      }

      if (!vault && snapshots.length === 0) return;

      this.db.exec('BEGIN IMMEDIATE');
      try {
        if (vault) {
          this.db
            .prepare(
              `INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)
               ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, json = excluded.json`
            )
            .run(vault.savedAt, JSON.stringify(vault.state));
        }
        const insertSnapshot = this.db.prepare(
          `INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, saved_at = excluded.saved_at, json = excluded.json`
        );
        for (const snapshot of snapshots) {
          insertSnapshot.run(
            snapshot.id,
            snapshot.kind,
            snapshot.savedAt,
            JSON.stringify(snapshot.state)
          );
        }
        this.db.exec('COMMIT');
      } catch (error) {
        try {
          this.db.exec('ROLLBACK');
        } catch {
          /* transaction may already be gone */
        }
        throw error;
      }

      this.logger.info(
        `[vault] imported legacy database ${this.legacyPath} (${vault ? 1 : 0} vault, ${snapshots.length} snapshots)`
      );
    } catch (error) {
      this.logger.warn(`[vault] legacy import skipped: ${error.message}`);
    } finally {
      if (legacy) {
        try {
          legacy.close();
        } catch {
          /* already closed */
        }
      }
    }
  }

  /* ---- vault ---- */

  readVault() {
    const row = this.db
      .prepare("SELECT saved_at, json FROM vault WHERE id = 'current'")
      .get();
    if (!row) return { record: null };
    return { record: { savedAt: row.saved_at, state: parseState(row.json) } };
  }

  writeVault(body) {
    if (!isPlainObject(body)) throw new ApiError(400, 'body is not a JSON object');
    if (!isPlainObject(body.state)) throw new ApiError(400, 'missing state');

    const savedAt = normalizeSavedAt(body.savedAt);
    this.db
      .prepare(
        `INSERT INTO vault (id, saved_at, json) VALUES ('current', ?, ?)
         ON CONFLICT(id) DO UPDATE SET saved_at = excluded.saved_at, json = excluded.json`
      )
      .run(savedAt, JSON.stringify(body.state));
    return { savedAt };
  }

  /* ---- snapshots ---- */

  listSnapshots() {
    const rows = this.db
      .prepare('SELECT id, kind, saved_at FROM snapshots ORDER BY saved_at DESC')
      .all();
    return {
      records: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        savedAt: row.saved_at,
      })),
    };
  }

  writeSnapshot(body) {
    if (!isPlainObject(body)) throw new ApiError(400, 'body is not a JSON object');

    const id = body.id;
    const kind = body.kind;
    if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new ApiError(400, 'bad id');
    if (typeof kind !== 'string' || !SAFE_KINDS.has(kind)) throw new ApiError(400, 'bad kind');
    if (!isPlainObject(body.state)) throw new ApiError(400, 'missing state');

    const savedAt = normalizeSavedAt(body.savedAt);
    this.db
      .prepare(
        `INSERT INTO snapshots (id, kind, saved_at, json) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, saved_at = excluded.saved_at, json = excluded.json`
      )
      .run(id, kind, savedAt, JSON.stringify(body.state));
    return { id };
  }

  readSnapshot(id) {
    const row = this.db
      .prepare('SELECT id, kind, saved_at, json FROM snapshots WHERE id = ?')
      .get(id);
    if (!row) return { record: null };
    return {
      record: {
        id: row.id,
        kind: row.kind,
        savedAt: row.saved_at,
        state: parseState(row.json),
      },
    };
  }

  deleteSnapshot(id) {
    const result = this.db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
    return { deleted: Number(result.changes) > 0 };
  }

  /* ---- routing, mirroring server.py's /api surface ---- */

  handle(method, pathname, body) {
    const verb = String(method || 'GET').toUpperCase();

    if (pathname === '/api/vault') {
      if (verb === 'GET' || verb === 'HEAD') return { status: 200, payload: this.readVault() };
      if (verb === 'PUT') return { status: 200, payload: this.writeVault(body) };
      throw new ApiError(405, 'method not allowed');
    }

    if (pathname === '/api/snapshots') {
      if (verb === 'GET' || verb === 'HEAD') return { status: 200, payload: this.listSnapshots() };
      if (verb === 'POST') return { status: 200, payload: this.writeSnapshot(body) };
      throw new ApiError(405, 'method not allowed');
    }

    if (pathname.startsWith('/api/snapshots/')) {
      const parts = pathname.split('/');
      if (parts.length !== 4 || parts[1] !== 'api' || parts[2] !== 'snapshots') {
        throw new ApiError(400, 'bad snapshot path');
      }

      let id;
      try {
        id = decodeURIComponent(parts[3]);
      } catch {
        throw new ApiError(400, 'bad snapshot id');
      }
      if (!SAFE_ID.test(id)) throw new ApiError(400, 'bad snapshot id');

      if (verb === 'GET' || verb === 'HEAD') return { status: 200, payload: this.readSnapshot(id) };
      if (verb === 'DELETE') return { status: 200, payload: this.deleteSnapshot(id) };
      throw new ApiError(405, 'method not allowed');
    }

    throw new ApiError(404, 'not found');
  }
}

module.exports = {
  VaultService,
  ApiError,
  MAX_BODY,
  SAFE_ID,
  SAFE_KINDS,
};
