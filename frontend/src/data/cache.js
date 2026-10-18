// Remembered data, so pages show what they had at once and refresh quietly
// in the background ("stale while revalidate"). Kept in memory for the
// session; the big lists (students, staff) are also kept on the device
// (IndexedDB), so the app opens instantly next time. Cleared on sign-out.

const mem = new Map();
const DB = "godview-cache";
const STORE = "kv";

function idb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("no idb"));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  try {
    const db = await idb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

async function idbSet(key, value) {
  try {
    const db = await idb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(value, key);
  } catch {
    // Private mode or storage full: memory still works.
  }
}

export function peek(key) {
  return mem.get(key);
}

export function remember(key, value, persist = false) {
  mem.set(key, value);
  if (persist) idbSet(key, value);
}

// Calls set() with the remembered value straight away (memory, else the
// device copy), then with fresh data when it arrives. Returns a promise for
// the fresh data. Several components asking for the same key at once (e.g.
// two widgets on Home both reading notices) share one request: each still
// gets its own set() call when it resolves, but only one fetch goes out.
// maxAge (ms): skip the refresh if this was fetched that recently.
const fetchedAt = new Map();
const inflight = new Map();
export function swr(key, fetcher, set, { persist = false, maxAge = 0 } = {}) {
  let fresh = false;
  if (mem.has(key)) {
    set(mem.get(key));
    if (maxAge && Date.now() - (fetchedAt.get(key) ?? 0) < maxAge) return Promise.resolve(mem.get(key));
  } else if (persist) {
    idbGet(key).then((v) => {
      if (v !== undefined && !fresh && !mem.has(key)) set(v);
    });
  }
  if (!inflight.has(key)) {
    inflight.set(
      key,
      fetcher().finally(() => inflight.delete(key))
    );
  }
  return inflight.get(key).then((v) => {
    fresh = true;
    fetchedAt.set(key, Date.now());
    remember(key, v, persist);
    set(v);
    return v;
  });
}

// Same, as a promise of the remembered value (or the fresh one if none).
export function cachedOr(key, fetcher) {
  return mem.has(key) ? Promise.resolve(mem.get(key)) : fetcher().then((v) => (mem.set(key, v), v));
}

export function forget(prefix = "") {
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) (mem.delete(k), fetchedAt.delete(k));
}

export async function clearCache() {
  mem.clear();
  try {
    indexedDB.deleteDatabase(DB);
  } catch {
    // nothing stored
  }
}
