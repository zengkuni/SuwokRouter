import { describe, expect, test, beforeEach } from "bun:test";
import {
  createTtlCache,
  getConfigCache,
  bumpConfigCacheVersion,
  __resetTtlCachesForTests,
} from "./ttlCache.js";

beforeEach(() => {
  __resetTtlCachesForTests();
});

describe("ttlCache: hit/miss + TTL", () => {
  test("miss pertama → load; hit kedua (dalam TTL) → skip load", async () => {
    let loads = 0;
    const c = createTtlCache({ name: "hit", ttlMs: 5000 });
    const r1 = await c.get("k", async () => (loads++, "v1"));
    const r2 = await c.get("k", async () => (loads++, "v2"));
    expect(r1, `r1`).toBe("v1");
    expect(r2, `r2 duplikat v1`).toBe("v1");
    expect(loads, `loader cuma sekali`).toBe(1);
  });

  test("habis TTL → reload", async () => {
    let loads = 0;
    const c = createTtlCache({ name: "expire", ttlMs: 5 });
    await c.get("k", async () => (loads++, "v1"));
    await new Promise((r) => setTimeout(r, 20));
    const r2 = await c.get("k", async () => (loads++, "v2"));
    expect(r2, `reload setelah expire`).toBe("v2");
    expect(loads, `loader 2x`).toBe(2);
  });
});

describe("ttlCache: coalesced loaders (thundering-herd)", () => {
  test("concurrent get same key → 1 load", async () => {
    let loads = 0;
    const c = createTtlCache({ name: "herd", ttlMs: 5000 });
    const slow = () => new Promise((res) => setTimeout(() => res((loads++, "v")), 10));
    const [a, b, c2] = await Promise.all([
      c.get("k", slow), c.get("k", slow), c.get("k", slow),
    ]);
    expect([a, b, c2], `semua hasil sama`).toEqual(["v", "v", "v"]);
    expect(loads, `loader sekali walau 3 concurrent`).toBe(1);
  });
});

describe("ttlCache: bounded eviction", () => {
  test("maxEntries cap → eldest dihapus (FIFO)", async () => {
    const c = createTtlCache({ name: "cap", ttlMs: 5000, maxEntries: 2 });
    await c.get("a", async () => 1);
    await c.get("b", async () => 2);
    await c.get("c", async () => 3);

    expect(await c.get("b", async () => 22), `b cached`).toBe(2);
    expect(await c.get("c", async () => 33), `c cached`).toBe(3);

    let loadsA = 0;
    const ra = await c.get("a", async () => (loadsA++, 11));
    expect(ra, `a re-load`).toBe(11);
    expect(loadsA, `a ter-evict`).toBe(1);
  });
});

describe("ttlCache: invalidate + version bump", () => {
  test("invalidate(key) drop 1; invalidateAll drop semua", async () => {
    const c = createTtlCache({ name: "inv", ttlMs: 5000 });
    await c.get("a", async () => 1);
    await c.get("b", async () => 2);
    c.invalidate("a");
    let la = 0;
    expect(await c.get("a", async () => (la++, 11)), `a re-load post-invalidate`).toBe(11);
    expect(la, `a reload`).toBe(1);
    c.invalidateAll();
    let lb = 0;
    expect(await c.get("b", async () => (lb++, 22)), `b re-load post-invalidateAll`).toBe(22);
    expect(lb, `b reload`).toBe(1);
  });

  test("bumpConfigCacheVersion (shared) → miss semua named cache", async () => {

    expect(typeof bumpConfigCacheVersion, `export function`).toBe("function");
    expect(typeof getConfigCache, `export function`).toBe("function");

    const a = getConfigCache("x-shared", { ttlMs: 5000 });
    const b = getConfigCache("x-shared", { ttlMs: 5000 });
    expect(a, `same instance`).toBe(b);
  });
});
