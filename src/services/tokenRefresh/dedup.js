import crypto from "node:crypto";

const REFRESH_RESULT_TTL_MS = 10_000;
const MAX_REFRESH_CACHE_ENTRIES = 1024;
const REFRESH_CACHE_SWEEP_MS = 30_000;
const refreshDedupCache = new Map();

function cacheKey(provider, oldToken) {

  return `${provider}:${crypto.createHash("sha256").update(oldToken).digest("hex")}`;
}

function pruneCache(now = Date.now()) {
  for (const [key, entry] of refreshDedupCache) {
    if (!entry?.promise && (!entry?.expiresAt || entry.expiresAt <= now)) {
      refreshDedupCache.delete(key);
    }
  }
  while (refreshDedupCache.size > MAX_REFRESH_CACHE_ENTRIES) {
    const oldestKey = refreshDedupCache.keys().next().value;
    if (oldestKey === undefined) break;
    refreshDedupCache.delete(oldestKey);
  }
}

const refreshCacheSweep = setInterval(() => pruneCache(), REFRESH_CACHE_SWEEP_MS);
refreshCacheSweep.unref?.();

export async function dedupRefresh(provider, oldToken, fn, log) {
  if (!oldToken) return fn();
  pruneCache();
  const key = cacheKey(provider, oldToken);
  const hit = refreshDedupCache.get(key);
  if (hit) {
    if (hit.promise) {
      log?.info?.("TOKEN_REFRESH", `Reusing in-flight refresh for ${provider}`);
      return hit.promise;
    }
    if (hit.expiresAt > Date.now()) {
      log?.info?.("TOKEN_REFRESH", `Reusing recent refresh result for ${provider}`);
      return hit.result;
    }
    refreshDedupCache.delete(key);
  }
  const promise = (async () => {
    try {
      const result = await fn();

      if (refreshDedupCache.get(key)?.promise === promise) {
        refreshDedupCache.set(key, { result, expiresAt: Date.now() + REFRESH_RESULT_TTL_MS });
        pruneCache();
      }
      return result;
    } catch (err) {
      refreshDedupCache.delete(key);
      throw err;
    }
  })();
  refreshDedupCache.set(key, { promise });
  pruneCache();
  return promise;
}

export function __resetRefreshDedupForTests() {
  refreshDedupCache.clear();
}

export function __getRefreshDedupSizeForTests() {
  return refreshDedupCache.size;
}
