import { getAdapter } from "../db/driver.js";

const DEFAULT_TTL_MS = 5000;
const DEFAULT_MAX_ENTRIES = 64;
const VERSION_META_KEY = "configCacheVersion";

if (!global._swayTtlCache) {
  global._swayTtlCache = {

    caches: new Map(),

    inflight: new Map(),
  };
}
const STATE = global._swayTtlCache;

export function createTtlCache(opts) {
  const name = opts.name;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;

  if (!STATE.caches.has(name)) STATE.caches.set(name, new Map());
  if (!STATE.inflight.has(name)) STATE.inflight.set(name, new Map());

  const entries = STATE.caches.get(name);
  const inflight = STATE.inflight.get(name);

  async function currentVersionAsync() {
    try {
      const db = await getAdapter();
      const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [VERSION_META_KEY]);
      return row ? parseInt(row.value, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  async function bumpVersion() {
    const db = await getAdapter();

    let next = 0;
    db.transaction(() => {
      const row = db.get(`SELECT value FROM _meta WHERE key = ?`, [VERSION_META_KEY]);
      const cur = row ? parseInt(row.value, 10) || 0 : 0;
      next = cur + 1;
      db.run(
        `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        [VERSION_META_KEY, String(next)],
      );
    });

    invalidateAll();
    return next;
  }

  function invalidate(key) {
    entries.delete(key);
    inflight.delete(key);
  }

  function invalidateAll() {
    entries.clear();
    inflight.clear();
  }

  async function get(key, loader) {
    const now = Date.now();
    const persisted = await currentVersionAsync();
    const hit = entries.get(key);
    if (hit && hit.expireAt > now && hit.seenVersion === persisted) {
      return hit.value;
    }

    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        try {
          const value = await loader();
          set(key, value, ttlMs);

          const entry = entries.get(key);
          if (entry) entry.seenVersion = persisted;
          return value;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
    }
    return p;
  }

  function set(key, value, ttlOverride) {
    const expireAt = Date.now() + (ttlOverride ?? ttlMs);

    if (!entries.has(key) && entries.size >= maxEntries) {
      const eldestKey = entries.keys().next().value;
      if (eldestKey !== undefined) entries.delete(eldestKey);
    }
    entries.set(key, { value, expireAt, seenVersion: 0 });
  }

  function size() {
    return entries.size;
  }

  return {
    get,
    set,
    invalidate,
    invalidateAll,
    bumpVersion,
    currentVersion: () => 0,
    currentVersionAsync,
    size,
  };
}

export function cachedRead(name, loader, opts = {}) {
  const cache = createTtlCache({ name, ttlMs: opts.ttlMs });
  const key = opts.key ?? "default";
  return () => cache.get(key, loader);
}

const NAMED_CACHES = new Map();

export function getConfigCache(name, opts = {}) {
  let c = NAMED_CACHES.get(name);
  if (c) return c;
  c = createTtlCache({ name, ttlMs: opts.ttlMs });
  NAMED_CACHES.set(name, c);
  return c;
}

export async function bumpConfigCacheVersion() {

  for (const c of NAMED_CACHES.values()) {
    const v = await c.bumpVersion();

    for (const other of NAMED_CACHES.values()) if (other !== c) other.invalidateAll();
    return v;
  }

  const tmp = createTtlCache({ name: "__bootstrap", ttlMs: DEFAULT_TTL_MS });
  NAMED_CACHES.set("__bootstrap", tmp);
  return await tmp.bumpVersion();
}

export function __resetTtlCachesForTests() {
  STATE.caches.clear();
  STATE.inflight.clear();
  NAMED_CACHES.clear();
}
