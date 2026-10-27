'use strict';

/*
 * Pathstone database layer (v0.3).
 *
 * Three tiers, newest-wins at boot:
 *   1. SQLite file — data/pathstone.db via the local server API. The durable
 *      home: a real database with a .db extension on disk, owned by
 *      server.py (stdlib only).
 *   2. IndexedDB (pathstone-db) — the on-device fallback when the local
 *      server is not running (plain static hosting, GH Pages, file servers).
 *   3. localStorage mirror — synchronous and instant: it always holds the
 *      newest change, even if a crash interrupts everything above it.
 *
 * On boot the copies are compared by savedAt; the winner becomes the state
 * and is pushed into every other reachable tier, so the tiers converge
 * instead of silently diverging.
 *
 * Every public function here is tier-agnostic: callers do not know which
 * engine is active.
 */

const DB_NAME = 'pathstone-db';
const DB_VERSION = 1;
const VAULT_STORE = 'vault';
const SNAPSHOT_STORE = 'snapshots';
const VAULT_RECORD = 'current';
const SNAPSHOT_KEEP_DAILY = 14;
const SNAPSHOT_KEEP_TOTAL = 30;

let dbHandle = null;
let dbMode = 'idb'; /* 'server' | 'idb' — set by boot() after probing */

function dbClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isServerMode() {
  return dbMode === 'server' && typeof window.fetch === 'function';
}

/* ---- tier 1: the SQLite server ---- */

const PROBE_TIMEOUT = 1500;

function srvFetch(path, options = {}) {
  if (typeof window.fetch !== 'function') return Promise.reject(new Error('no-fetch'));
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  if (controller && !options.signal) {
    timer = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT);
    options.signal = controller.signal;
  }
  return window.fetch(path, options).then((response) => {
    if (timer) window.clearTimeout(timer);
    if (!response.ok) throw new Error(`api-${response.status}`);
    return response.json();
  }).catch((error) => {
    if (timer) window.clearTimeout(timer);
    throw error;
  });
}

function srvReadVault() {
  return srvFetch('/api/vault').then((body) => body.record || null);
}

function srvWriteVault(state, savedAt, extra) {
  const options = {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state, savedAt }),
  };
  if (extra && extra.keepalive) options.keepalive = true;
  return srvFetch('/api/vault', options).then((body) => body.savedAt);
}

function srvWriteSnapshot(kind, state, id) {
  /* same id generation as the IndexedDB path — both engines must speak the
   * exact same snapshot identity, or cross-mode restore breaks */
  const key = id || `snap-${kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  return srvFetch('/api/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: key, kind, state, savedAt: new Date().toISOString() }),
  }).then(() => key);
}

function srvListSnapshots() {
  return srvFetch('/api/snapshots').then((body) => body.records || []);
}

function srvReadSnapshot(id) {
  return srvFetch(`/api/snapshots/${encodeURIComponent(id)}`).then((body) => body.record);
}

function srvDeleteSnapshot(id) {
  return srvFetch(`/api/snapshots/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(() => true);
}

function srvOpenOk() {
  return srvReadVault().then(() => true);
}

/* ---- tier 2: IndexedDB ---- */

function openDatabase() {
  if (dbHandle) return Promise.resolve(dbHandle);
  const service = typeof window.indexedDB === 'undefined' ? null : window.indexedDB;
  if (!service) return Promise.reject(new Error('no-indexeddb'));
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = service.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) db.createObjectStore(VAULT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => {
      dbHandle = request.result;
      resolve(dbHandle);
    };
    request.onerror = () => reject(request.error || new Error('indexeddb-open-failed'));
    request.onblocked = () => reject(new Error('indexeddb-blocked'));
  });
}

function idbWriteVault(state) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    const record = { id: VAULT_RECORD, savedAt: new Date().toISOString(), state: dbClone(state) };
    tx.objectStore(VAULT_STORE).put(record);
    tx.oncomplete = () => resolve(record.savedAt);
    tx.onerror = () => reject(tx.error || new Error('vault-write-failed'));
    tx.onabort = () => reject(tx.error || new Error('vault-write-aborted'));
  }));
}

function idbReadVault() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const request = tx.objectStore(VAULT_STORE).get(VAULT_RECORD);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('vault-read-failed'));
    tx.onabort = () => reject(tx.error || new Error('vault-read-aborted'));
  }));
}

function idbWriteSnapshot(kind, state, id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    const key = id || `snap-${kind}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const record = { id: key, kind, savedAt: new Date().toISOString(), state: dbClone(state) };
    tx.objectStore(SNAPSHOT_STORE).put(record);
    tx.oncomplete = () => resolve(key);
    tx.onerror = () => reject(tx.error || new Error('snapshot-write-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-write-aborted'));
  }));
}

function idbListSnapshots() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const request = tx.objectStore(SNAPSHOT_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('snapshot-list-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-list-aborted'));
  }));
}

function idbReadSnapshot(id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const request = tx.objectStore(SNAPSHOT_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('snapshot-read-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-read-aborted'));
  }));
}

function idbDeleteSnapshot(id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('snapshot-delete-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-delete-aborted'));
  }));
}

/* ---- tier-agnostic API (public surface) ---- */

function readVaultFromDb() {
  return isServerMode() ? srvReadVault() : idbReadVault();
}

/* savedAt matters only in server mode: reconciliation pushes the mirror with
 * its own timestamp so newest-wins stays consistent across boots. */
function writeVaultToDb(state, savedAt, extra) {
  if (isServerMode()) return srvWriteVault(state, savedAt, extra);
  return idbWriteVault(state);
}

function writeSnapshotToDb(kind, state, id) {
  if (isServerMode()) return srvWriteSnapshot(kind, state, id);
  return idbWriteSnapshot(kind, state, id);
}

function listSnapshots() {
  return isServerMode() ? srvListSnapshots() : idbListSnapshots();
}

function readSnapshot(id) {
  return isServerMode() ? srvReadSnapshot(id) : idbReadSnapshot(id);
}

function deleteSnapshot(id) {
  if (isServerMode()) return srvDeleteSnapshot(id);
  return idbDeleteSnapshot(id);
}

/* Called once from boot(): decides which tier is live. Prefers the SQLite
 * server (the tier with the .db file), falls back to IndexedDB. Returns the
 * decision; boot() owns the state comparisons. */
/* Called once from boot(): decides which tier is live. Prefers the SQLite
 * server (the tier with the .db file), falls back to IndexedDB. Throws when
 * both are unreachable — boot() then falls back to mirror-only mode. */
function decideActiveTier() {
  return srvOpenOk().then(() => {
    dbMode = 'server';
    return 'server';
  }).catch(() => {
    dbMode = 'idb';
    return openDatabase().then(() => 'idb');
  });
}

function timeOfRecord(record) {
  const stamp = record && record.savedAt ? new Date(record.savedAt).getTime() : 0;
  return Number.isFinite(stamp) ? stamp : 0;
}

function newestOf(a, b) {
  if (!a) return b;
  if (!b) return a;
  return timeOfRecord(a) >= timeOfRecord(b) ? a : b;
}

/* Prune: keep the newest SNAPSHOT_KEEP_DAILY 'auto' snapshots, and never more
 * than SNAPSHOT_KEEP_TOTAL snapshots of any kind. Oldest lose. Works
 * identically over both engines (list + delete). */
function pruneSnapshots() {
  return listSnapshots().then((records) => {
    const sorted = records.slice().sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
    const victims = new Set();
    const autoSorted = sorted.filter((record) => record.kind === 'auto');
    if (autoSorted.length > SNAPSHOT_KEEP_DAILY) {
      autoSorted.slice(0, autoSorted.length - SNAPSHOT_KEEP_DAILY).forEach((record) => victims.add(record.id));
    }
    const remaining = sorted.filter((record) => !victims.has(record.id));
    if (remaining.length > SNAPSHOT_KEEP_TOTAL) {
      remaining.slice(0, remaining.length - SNAPSHOT_KEEP_TOTAL).forEach((record) => victims.add(record.id));
    }
    return Promise.all(Array.from(victims).map((id) => deleteSnapshot(id)));
  });
}
