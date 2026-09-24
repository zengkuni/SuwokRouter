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

// Valkey with a hot fail-open to the memory backend: a command that throws
// (connection still establishing, brief outage) must not drop the value the
// caller just wrote — it degrades to memory for that op. After
// FAILURE_THRESHOLD consecutive failures the store flips to memory for good
// until reset (circuit-breaker), instead of paying a timeout on every call.
const FAILURE_THRESHOLD = 3;

function createRedisTtl(redis) {
  const memory = createMemoryTtl();
  let failures = 0;
  const fail = () => {
    failures += 1;
    if (failures >= FAILURE_THRESHOLD) resetTtlStore();
    return true;
  };
  return {
    kind: "valkey",
    async get(key) {
      try {
        const value = await redis.get(key);
        failures = 0;
        return value;
      } catch {
        if (fail()) return memory.get(key);
      }
    },
    async set(key, text, ttlMs) {
      try {
        if (ttlMs > 0) await redis.set(key, text, "PX", ttlMs);
        else await redis.set(key, text);
        failures = 0;
      } catch {
        if (fail()) await memory.set(key, text, ttlMs);
      }
    },
    async del(key) {
      try {
        await redis.del(key);
        failures = 0;
      } catch {
        if (fail()) await memory.del(key);
      }
    },
    async expire(key, ttlMs) {
      try {
        await redis.pexpire(key, ttlMs);
        failures = 0;
      } catch {
        if (fail()) await memory.expire(key, ttlMs);
      }
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
