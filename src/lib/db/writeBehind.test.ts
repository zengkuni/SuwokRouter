import { describe, expect, test, beforeEach, afterAll } from "bun:test";
import { initDb } from "../db/index.js";
import { getAdapter } from "../db/driver.js";
import {
  getWriteBehindBuffer,
  flushAllWriteBehindBuffers,
  __resetWriteBehindForTests,
} from "./writeBehind.js";
import { __resetMetricsForTests } from "@/observability/metrics.js";
import { saveRequestUsage, getUsageHistory, getUsageStats, flushUsageBuffer } from "./repos/usageRepo.js";

beforeEach(() => {
  __resetWriteBehindForTests();
  __resetMetricsForTests();
});

afterAll(async () => {

  try {
    const db = await getAdapter();
    db.run(`DELETE FROM usageHistory WHERE model LIKE 'wb-test-%'`);

    await getUsageStats("all");
    db.run(`DELETE FROM _meta WHERE key = 'configCacheVersion'`);
  } catch {}
});

describe("writeBehind: coalescing", () => {
  test("close flushes pending rows before marking the buffer closed", async () => {
    let flushed = 0;
    const buf = getWriteBehindBuffer({
      name: "close-drain",
      flushFn: async (rows: unknown[]) => { flushed += rows.length; },
      flushMs: 10000,
      batchSize: 1000,
    });
    buf.push({ id: 1 });
    await buf.close();
    expect(flushed).toBe(1);
    expect(buf.pendingSize()).toBe(0);
  });

  test("push 5 row → 1 flush事务 (coalesced)", async () => {
    let flushCount = 0;
    let flushedRows = 0;
    const buf = getWriteBehindBuffer({
      name: "coalesce",
      flushFn: async (rows: unknown[]) => { flushCount++; flushedRows += rows.length; },
      flushMs: 200, batchSize: 1000,
    });
    for (let i = 0; i < 5; i++) buf.push({ i });

    await new Promise((r) => setTimeout(r, 350));
    expect(flushCount, `1 flush`).toBe(1);
    expect(flushedRows, `5 baris tertulis`).toBe(5);
    await buf.close();
  });

  test("batch threshold → flush langsung (kagak tunggu timer)", async () => {
    let flushCount = 0;
    let flushedRows = 0;
    const buf = getWriteBehindBuffer({
      name: "batch",
      flushFn: async (rows: unknown[]) => { flushCount++; flushedRows += rows.length; },
      flushMs: 10000, batchSize: 3,
    });
    for (let i = 0; i < 3; i++) buf.push({ i });
    await new Promise((r) => setTimeout(r, 50));
    expect(flushCount, `flush saat batch=3`).toBe(1);
    expect(flushedRows, `3 baris`).toBe(3);
    await buf.close();
  });
});

describe("writeBehind: backpressure", () => {
  test(">1000 row → flush synchronous (kagak grow unbounded)", async () => {
    let flushed = 0;
    const buf = getWriteBehindBuffer({
      name: "bpressure",
      flushFn: async (rows: unknown[]) => { flushed += rows.length; },
      flushMs: 100000, batchSize: 100000,
    });
    for (let i = 0; i < 1001; i++) buf.push({ i });

    await new Promise((r) => setTimeout(r, 100));
    expect(buf.pendingSize(), `pending kecil abis backpressure flush`).toBeLessThan(1001);
    expect(flushed, `ter-flush`).toBeGreaterThan(0);
    await buf.close();
  });
});

describe("writeBehind: flush-before-read (usageRepo)", () => {
  test("saveRequestUsage → buffer → getUsageHistory liat (flush-before-read)", async () => {
    await initDb();
    const stamp = `wb-test-${Date.now()}`;
    await saveRequestUsage({
      provider: "wb-test",
      model: stamp,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      timestamp: new Date().toISOString(),
      apiKey: "wb-test-key",
    });

    const hist = await getUsageHistory({ model: stamp });
    const found = hist.find((h: any) => h.model === stamp);
    expect(found, `row visible post flush-before-read`).toBeTruthy();
    expect(found?.tokens?.prompt_tokens ?? found?.prompt_tokens, `prompt_tokens 10`).toBeTruthy();
  });

  test("flushUsageBuffer explicit + flushAll", async () => {
    await initDb();
    await saveRequestUsage({
      provider: "wb-test",
      model: `wb-test-flushAll-${Math.random().toString(36).slice(2,8)}`,
      tokens: { prompt_tokens: 1, completion_tokens: 1 },
      timestamp: new Date().toISOString(),
    });
    await flushUsageBuffer();
    await flushAllWriteBehindBuffers();

    expect(true, `flushAll no throw`).toBe(true);
  });

  test("stats repair removes orphaned test aggregates", async () => {
    await initDb();
    const stamp = `wb-test-reconcile-${Math.random().toString(36).slice(2, 8)}`;
    await saveRequestUsage({
      provider: "wb-test",
      model: stamp,
      tokens: { prompt_tokens: 2, completion_tokens: 3 },
      timestamp: new Date().toISOString(),
    });
    await flushUsageBuffer();

    const db = await getAdapter();
    db.run("DELETE FROM usageHistory WHERE model = ?", [stamp]);

    const stats = await getUsageStats("all");
    const testModelRows = Object.values(stats.byModel || {}).filter(
      (row: any) => row.rawModel === stamp,
    );
    expect(testModelRows, "orphaned test model is not reported").toHaveLength(0);
    expect(
      Number(db.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'")?.value || 0),
      "lifetime counter matches canonical history",
    ).toBe(Number(db.get("SELECT COUNT(*) AS count FROM usageHistory")?.count || 0));
  });
});
