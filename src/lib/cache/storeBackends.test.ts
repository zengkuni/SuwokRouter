import { describe, expect, test } from "bun:test";
import { createTtlStore } from "./ttlStore.js";
import { createLockStore } from "./lockStore.js";
import { getRedis, closeRedis } from "./redisClient.js";

const REDIS_URL = process.env.REDIS_URL || "";
const valkey = REDIS_URL ? describe : describe.skip;

// Memory backend (REDIS_URL unset path + degradation path) — always
// deterministic; no external service needed.
describe("ttlStore (memory backend)", () => {
  test("set/get/del round-trip", async () => {
    const store = createTtlStore(null);
    await store.set("k", { a: 1 }, 60_000);
    expect(await store.get("k")).toEqual({ a: 1 });
    await store.del("k");
    expect(await store.get("k")).toBeNull();
  });

  test("expired entry disappears", async () => {
    const store = createTtlStore(null);
    await store.set("k", "v", 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(await store.get("k")).toBeNull();
  });
});

describe("lockStore (memory backend)", () => {
  test("second concurrent acquire fails; release frees it", async () => {
    const locks = createLockStore(null);
    const token = await locks.acquire("res", 5_000);
    expect(token).toBeTruthy();
    expect(await locks.acquire("res", 5_000)).toBeNull();
    await locks.release("res", token);
    expect(await locks.acquire("res", 5_000)).toBeTruthy();
  });

  test("release with a stale token does not free someone else's lock", async () => {
    const locks = createLockStore(null);
    const a = await locks.acquire("res", 5_000);
    await locks.release("res", "not-the-token");
    expect(await locks.acquire("res", 5_000)).toBeNull();
    await locks.release("res", a);
  });

  test("ttl expiry frees the lock without release", async () => {
    const locks = createLockStore(null);
    await locks.acquire("res", 20);
    await new Promise((r) => setTimeout(r, 40));
    expect(await locks.acquire("res", 5_000)).toBeTruthy();
  });
});

// Live Valkey (docker compose valkey service). Skipped without REDIS_URL.
valkey("store backends (valkey)", () => {
  const redis = REDIS_URL ? getRedis() : null;
  const prefix = `test:${Math.random().toString(36).slice(2, 8)}`;

  test("ttl set/get/del + expiry against valkey", async () => {
    if (!redis) return;
    const store = createTtlStore(redis);
    expect(store.kind).toBe("valkey");
    await store.set(`${prefix}:k`, "v", 60_000);
    expect(await store.get(`${prefix}:k`)).toBe("v");
    await store.set(`${prefix}:e`, "v", 30);
    await new Promise((r) => setTimeout(r, 60));
    expect(await store.get(`${prefix}:e`)).toBeNull();
    await store.del(`${prefix}:k`);
    expect(await store.get(`${prefix}:k`)).toBeNull();
  });

  test("lock acquire contends, stale-token release is a no-op", async () => {
    if (!redis) return;
    const locks = createLockStore(redis);
    const token = await locks.acquire(`${prefix}:lock`, 10_000);
    expect(token).toBeTruthy();
    expect(await locks.acquire(`${prefix}:lock`, 10_000)).toBeNull();
    await locks.release(`${prefix}:lock`, "wrong-token");
    expect(await locks.acquire(`${prefix}:lock`, 10_000)).toBeNull();
    await locks.release(`${prefix}:lock`, token);
    expect(await locks.acquire(`${prefix}:lock`, 10_000)).toBeTruthy();
    const second = await locks.acquire(`${prefix}:lock`, 10_000);
    await locks.release(`${prefix}:lock`, second);
  });

  test("lock ttl frees an abandoned lock", async () => {
    if (!redis) return;
    const locks = createLockStore(redis);
    await locks.acquire(`${prefix}:ttl`, 50);
    await new Promise((r) => setTimeout(r, 90));
    expect(await locks.acquire(`${prefix}:ttl`, 5_000)).toBeTruthy();
    const t = await locks.acquire(`${prefix}:ttl`, 5_000);
    await locks.release(`${prefix}:ttl`, t);
  });

  test("closeRedis disconnects cleanly", async () => {
    if (!redis) return;
    await closeRedis();
  });
});
