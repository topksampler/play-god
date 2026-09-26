import type { WorldState } from '../shared/types';

/** Full world snapshots of earlier runs, kept in IndexedDB (too large for localStorage), keyed by run summary key. */
const DB = 'playgod-runs';
const STORE = 'snapshots';
const KEEP = 8;

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function saveRunSnapshot(key: string, world: WorldState, keepKeys: string[]): Promise<void> {
  const db = await open();
  if (!db) return;
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  try {
    store.put(structuredClone(world), key);
  } catch {
    return; // not cloneable / quota: skip silently, the summary still exists
  }
  // Drop snapshots for runs no longer in the summary list.
  const keys = store.getAllKeys();
  keys.onsuccess = () => {
    const keep = new Set([key, ...keepKeys.slice(0, KEEP)]);
    for (const k of keys.result) if (!keep.has(String(k))) store.delete(k);
  };
}

export async function loadRunSnapshot(key: string): Promise<WorldState | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as WorldState | undefined) ?? null);
    req.onerror = () => resolve(null);
  });
}
