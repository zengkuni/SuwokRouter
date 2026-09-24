// Distributed mutex with an in-memory fallback.
//
// Valkey path: SET key <unique-token> NX PX ttl, release only when the token
// still matches (Lua compare-and-delete). A static "1" would let an
// expired-TTL caller delete a lock another process now owns (the 9router
// 69c5bcb9 bug class). Memory path mirrors the semantics for REDIS_URL-unset
// and degradation.

import { getRedis, isRedisAvailable } from "./redisClient.js";

const RELEASE_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

function createMemoryLock() {
  const held = new Map(); // key -> { token, timer }
  return {
    kind: "memory",
    async acquire(key, ttlMs) {
      const current = held.get(key);
      if (current) return null;
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry = { token, timer: null };
      entry.timer = setTimeout(() => held.delete(key), ttlMs);
      entry.timer?.unref?.();
      held.set(key, entry);
      return token;
    },
    async release(key, token) {
      const current = held.get(key);
      if (!current || current.token !== token) return false;
      clearTimeout(current.timer);
      held.delete(key);
      return true;
    },
  };
}

function createRedisLock(redis) {
  return {
    kind: "valkey",
    async acquire(key, ttlMs) {
      const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await redis.set(key, token, "PX", ttlMs, "NX");
      return res === "OK" ? token : null;
    },
    async release(key, token) {
      await redis.eval(RELEASE_LUA, 1, key, token);
      return true;
    },
  };
}

export function createLockStore(redis) {
  // redis: client | null. null forces memory (tests + degradation).
  if (redis && isRedisAvailable()) return createRedisLock(redis);
  return createMemoryLock();
}

let defaultLock = null;

export function getLockStore() {
  const redis = getRedis();
  const wantValkey = isRedisAvailable();
  if (!defaultLock || (defaultLock.kind === "valkey") !== wantValkey) {
    defaultLock = createLockStore(wantValkey ? redis : null);
  }
  return defaultLock;
}

export function resetLockStore() {
  defaultLock = null;
}

export async function acquireLock(key, ttlMs) {
  return getLockStore().acquire(key, ttlMs);
}

export async function releaseLock(key, token) {
  return getLockStore().release(key, token);
}
