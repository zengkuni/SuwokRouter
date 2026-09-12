import { afterEach, describe, expect, test } from "bun:test";
import {
  getAccountLoad,
  getProviderLoad,
  getCachedProviderConnections,
  rankConnectionsByInflight,
  resolveAccountPoolConfig,
  resetAccountPoolForTests,
  tryAcquireAccountSlot,
  waitForAccountCapacity,
} from "./accountPool.js";

const config = {
  enabled: true,
  maxConcurrentPerAccount: 1,
  maxQueuePerProvider: 1,
  queueWaitTimeoutMs: 500,
  cacheTtlMs: 1000,
};

afterEach(() => resetAccountPoolForTests());

describe("account pool leases", () => {
  test("uses a conservative global account default", () => {
    expect(resolveAccountPoolConfig({ accountPool: { enabled: true } }).maxConcurrentPerAccount).toBe(30);
  });

  test("ranks the least-loaded account first", () => {
    const release = tryAcquireAccountSlot("p", "a", { ...config, maxConcurrentPerAccount: 3 });
    expect(getAccountLoad("a")).toBe(1);

    const ranked = rankConnectionsByInflight([
      { id: "a", priority: 1 },
      { id: "b", priority: 2 },
    ]);
    expect(ranked.map((item) => item.id)).toEqual(["b", "a"]);

    release?.();
    expect(getAccountLoad("a")).toBe(0);
  });

  test("uses the least-recently assigned account when active loads tie", () => {
    const release = tryAcquireAccountSlot("p", "a", { ...config, maxConcurrentPerAccount: 3 });
    release?.();
    const ranked = rankConnectionsByInflight([
      { id: "a", priority: 1 },
      { id: "b", priority: 2 },
    ]);
    expect(ranked[0]?.id).toBe("b");
  });

  test("enforces the per-account limit and wakes a queued request", async () => {
    const first = tryAcquireAccountSlot("p", "a", config);
    expect(first).not.toBeNull();
    expect(tryAcquireAccountSlot("p", "a", config)).toBeNull();

    const waiting = waitForAccountCapacity("p", ["a"], config);
    first?.();
    expect(await waiting).toMatchObject({ ok: true, releasedConnectionId: "a" });

    const second = tryAcquireAccountSlot("p", "a", config);
    expect(second).not.toBeNull();
    second?.();
  });

  test("enforces the shared per-provider limit across accounts", async () => {
    const capped = { ...config, maxConcurrentPerAccount: 3, maxConcurrentPerProvider: 2 };
    const first = tryAcquireAccountSlot("p", "a", capped);
    const second = tryAcquireAccountSlot("p", "b", capped);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(getProviderLoad("p")).toBe(2);
    expect(tryAcquireAccountSlot("p", "c", capped)).toBeNull();

    const waiting = waitForAccountCapacity("p", ["a", "b", "c"], capped);
    first?.();
    expect(await waiting).toMatchObject({ ok: true, releasedConnectionId: "a" });
    const third = tryAcquireAccountSlot("p", "c", capped);
    expect(third).not.toBeNull();
    expect(getProviderLoad("p")).toBe(2);

    second?.();
    third?.();
    expect(getProviderLoad("p")).toBe(0);
  });

  test("bounds a full queue and strips credentials from the routing cache", async () => {
    const first = tryAcquireAccountSlot("p", "a", config);
    const firstWait = waitForAccountCapacity("p", ["a"], config);
    const rejected = await waitForAccountCapacity("p", ["a"], config);
    expect(rejected).toEqual({ ok: false, reason: "queue_full" });

    let calls = 0;
    const loader = async () => {
      calls += 1;
      return [{ id: "a", provider: "p", apiKey: "secret", accessToken: "token", priority: 1 }];
    };
    const firstPool = await getCachedProviderConnections("p", loader, config.cacheTtlMs);
    const secondPool = await getCachedProviderConnections("p", loader, config.cacheTtlMs);
    expect(calls).toBe(1);
    expect(firstPool[0]).not.toHaveProperty("apiKey");
    expect(firstPool[0]).not.toHaveProperty("accessToken");
    expect(secondPool).toEqual(firstPool);

    first?.();
    expect(await firstWait).toMatchObject({ ok: true, releasedConnectionId: "a" });
  });
});
