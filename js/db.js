'use strict';

/*
 * Pathstone database layer.
 *
 * The real database is IndexedDB: transactional, quota-scalable, and still
 * fully local (no account, no cloud, nothing leaves the device).
 *
 * Two stores:
 *   vault     — one record, id:'current', the live state
 *   snapshots — automatic daily snapshots, manual snapshots, and
 *               "safety catch" copies taken before a restore or import
 *
 * localStorage stays as a synchronous mirror: its write is instant, so even
 * a crash between transactions never loses the newest change. On boot the
 * copy with the newer savedAt wins, and the winner is pushed into the
 * database — so the two stores are eventually the same, never silently
 * diverged.
 */

const DB_NAME = 'pathstone-db';
const DB_VERSION = 1;
const VAULT_STORE = 'vault';
const SNAPSHOT_STORE = 'snapshots';
const VAULT_RECORD = 'current';
const SNAPSHOT_KEEP_DAILY = 14;
const SNAPSHOT_KEEP_TOTAL = 30;

let dbHandle = null;

function dbClone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function writeVaultToDb(state) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    const record = { id: VAULT_RECORD, savedAt: new Date().toISOString(), state: dbClone(state) };
    tx.objectStore(VAULT_STORE).put(record);
    tx.oncomplete = () => resolve(record.savedAt);
    tx.onerror = () => reject(tx.error || new Error('vault-write-failed'));
    tx.onabort = () => reject(tx.error || new Error('vault-write-aborted'));
  }));
}

function readVaultFromDb() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const request = tx.objectStore(VAULT_STORE).get(VAULT_RECORD);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('vault-read-failed'));
    tx.onabort = () => reject(tx.error || new Error('vault-read-aborted'));
  }));
}

function writeSnapshotToDb(kind, state, id) {
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

function listSnapshots() {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const request = tx.objectStore(SNAPSHOT_STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error || new Error('snapshot-list-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-list-aborted'));
  }));
}

function readSnapshot(id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readonly');
    const request = tx.objectStore(SNAPSHOT_STORE).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error('snapshot-read-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-read-aborted'));
  }));
}

function deleteSnapshot(id) {
  return openDatabase().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(SNAPSHOT_STORE, 'readwrite');
    tx.objectStore(SNAPSHOT_STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('snapshot-delete-failed'));
    tx.onabort = () => reject(tx.error || new Error('snapshot-delete-aborted'));
  }));
}

/* Prune: keep the newest SNAPSHOT_KEEP_DAILY 'auto' snapshots, and never more
 * than SNAPSHOT_KEEP_TOTAL snapshots of any kind. Oldest lose. */
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
