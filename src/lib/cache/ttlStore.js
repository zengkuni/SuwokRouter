// Distributed TTL key/value with an in-memory fallback.
//
// Two interchangeable backends behind one interface: Valkey when REDIS_URL is
// configured and healthy, in-process memory otherwise. Memory is the
// REDIS_URL-unset default AND the degradation path — a Redis outage must
// degrade to today's behavior, never brick request/auth paths.

import { getRedis, isRedisAvailable } from "./redisClient.js";

const SERIALIZE = JSON.stringify;
const DESERIALIZE = (text) => (text == null ? null : JSON.parse(text));

// In-memory backend: Map + per-key expiry timers.
function createMemoryTtl() {
  const map = new Map(); // key -> { value: string, timer }
  const touch = (entry) => {
    if (entry.timer) clearTimeout(entry.timer);
  };
  return {
    kind: "memory",
    async get(key) {
      const entry = map.get(key);
      return entry ? entry.value : null;
    },
    async set(key, text, ttlMs) {
      const prev = map.get(key);
      if (prev) touch(prev);
      const entry = { value: text, timer: null };
      if (ttlMs > 0) entry.timer = setTimeout(() => map.delete(key), ttlMs);
      entry.timer?.unref?.();
      map.set(key, entry);
    },
    async del(key) {
      const entry = map.get(key);
      if (entry) touch(entry);
      map.delete(key);
    },
    async expire(key, ttlMs) {
      const entry = map.get(key);
      if (!entry) return false;
      touch(entry);
      entry.timer = setTimeout(() => map.delete(key), ttlMs);
      entry.timer?.unref?.();
      return true;
    },
  };
}

function createRedisTtl(redis) {
  return {
    kind: "valkey",
    async get(key) {
      return redis.get(key);
    },
    async set(key, text, ttlMs) {
      if (ttlMs > 0) await redis.set(key, text, "PX", ttlMs);
      else await redis.set(key, text);
    },
    async del(key) {
      await redis.del(key);
    },
    async expire(key, ttlMs) {
      await redis.pexpire(key, ttlMs);
    },
  };
}

export function createTtlStore(redis) {
  // redis: client | null. null forces memory (tests + degradation).
  if (redis && isRedisAvailable()) return createRedisTtl(redis);
  return createMemoryTtl();
}

let defaultStore = null;

export function getTtlStore() {
  // getRedis() first: it lazily creates the client. Checking availability
  // before that would see a null client and pin the process to memory.
  const redis = getRedis();
  const wantValkey = isRedisAvailable();
  // Re-pick when availability flips: an outage degrades to memory and a
  // reconnect promotes back to valkey.
  if (!defaultStore || (defaultStore.kind === "valkey") !== wantValkey) {
    defaultStore = createTtlStore(wantValkey ? redis : null);
  }
  return defaultStore;
}

// Reset the memoized default store (REDIS_URL changed or connection dropped).
export function resetTtlStore() {
  defaultStore = null;
}

// Public helpers operate on VALUES (JSON); stores operate on strings.
export async function ttlGet(key) {
  const text = await getTtlStore().get(key);
  if (text == null) return null;
  try { return DESERIALIZE(text); } catch { return null; }
}

export async function ttlGetRaw(key) {
  return getTtlStore().get(key);
}

export async function ttlSet(key, value, ttlMs) {
  await getTtlStore().set(key, SERIALIZE(value), ttlMs);
}

export async function ttlSetRaw(key, text, ttlMs) {
  await getTtlStore().set(key, text, ttlMs);
}

export async function ttlDel(key) {
  await getTtlStore().del(key);
}
