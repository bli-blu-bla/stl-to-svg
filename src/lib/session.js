// The open files, kept for this tab's browser session: a reload brings them
// back, a new tab or a browser restart starts empty.
//
// sessionStorage alone has that lifetime but holds only a few megabytes, so
// it keeps just a session id; the meshes go to IndexedDB under that id. Each
// open tab holds a Web Lock named after its id, so on startup a session with
// no lock held is known to belong to a closed tab or an earlier browser run,
// and is deleted.
//
// Storage can be missing or refuse (private windows, quota): every call
// fails quietly and the app simply works without it.

const DB_NAME = 'stl-to-svg';
const STORE = 'sessions';
const ID_KEY = 'stl-to-svg:session';
const SELECTED_KEY = 'stl-to-svg:selected';
const LOCK_PREFIX = 'stl-to-svg:session:';

let current = null; // { id, db } once opened.

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function newId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function heldLocks() {
  if (!navigator.locks?.query) return null;
  const { held = [] } = await navigator.locks.query();
  return new Set(held.map((l) => l.name).filter((n) => n?.startsWith(LOCK_PREFIX)).map((n) => n.slice(LOCK_PREFIX.length)));
}

// Opens this tab's session and returns the files it held ([] for a new one)
// and the id of the file that was selected. Runs once per page load, however
// often it is called (React runs effects twice in development).
let restoring = null;
export function restoreSession() {
  restoring ??= restore();
  return restoring;
}

async function restore() {
  try {
    const db = await openDB();
    let id = sessionStorage.getItem(ID_KEY);
    const held = await heldLocks();

    // A duplicated tab copies sessionStorage, id included: it starts with the
    // same files under an id of its own, so the two tabs don't overwrite each other.
    const from = id;
    if (!id || held?.has(id)) id = newId();
    sessionStorage.setItem(ID_KEY, id);
    navigator.locks?.request(LOCK_PREFIX + id, () => new Promise(() => {})); // Held until the tab closes.

    const files = (from && await run(db, 'readonly', (s) => s.get(from))) || [];

    // Sessions of closed tabs or earlier browser runs.
    if (held) {
      const keys = await run(db, 'readonly', (s) => s.getAllKeys());
      const stale = keys.filter((k) => k !== id && !held.has(k));
      if (stale.length) await run(db, 'readwrite', (s) => { for (const k of stale) s.delete(k); });
    }

    current = { id, db };
    if (from !== id && files.length) await saveFiles(files);
    const selected = Number(sessionStorage.getItem(SELECTED_KEY));
    return { files, selectedId: Number.isFinite(selected) && selected > 0 ? selected : null };
  } catch {
    return { files: [], selectedId: null };
  }
}

export async function saveFiles(files) {
  if (!current) return;
  try {
    await run(current.db, 'readwrite', (s) => (files.length ? s.put(files, current.id) : s.delete(current.id)));
  } catch {
    // Quota or a closed database: the files just won't survive a reload.
  }
}

export function saveSelected(id) {
  try {
    if (id == null) sessionStorage.removeItem(SELECTED_KEY);
    else sessionStorage.setItem(SELECTED_KEY, String(id));
  } catch {
    // Ignore.
  }
}
