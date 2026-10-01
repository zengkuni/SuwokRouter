import { describe, expect, test } from "bun:test";
import { RouterAdmission, wrapResponseWithAdmission } from "./routerAdmission";

describe("router admission", () => {
  test("bounds active work and waiting callers, then drains FIFO capacity", async () => {
    const admission = new RouterAdmission({
      hardMaxConcurrent: 2,
      initialConcurrent: 2,
      minConcurrent: 1,
      maxQueue: 1,
      queueWaitMs: 500,
      bodyBudgetBytes: 100,
      autoSample: false,
    });
    const first = await admission.acquire(10);
    const second = await admission.acquire(10);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);

    const waiting = admission.acquire(10);
    const rejected = await admission.acquire(10);
    expect(rejected).toEqual({ ok: false, reason: "queue_full" });

    first.lease?.releaseBody();
    first.lease?.release();
    expect((await waiting).ok).toBe(true);
    waiting.then((result) => {
      result.lease?.releaseBody();
      result.lease?.release();
    });
    second.lease?.releaseBody();
    second.lease?.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admission.snapshot().active).toBe(0);
    expect(admission.snapshot().bodyBytesInUse).toBe(0);
  });

  test("bounds retained body bytes independently from active slots", async () => {
    const admission = new RouterAdmission({
      hardMaxConcurrent: 4,
      initialConcurrent: 4,
      minConcurrent: 1,
      maxQueue: 2,
      queueWaitMs: 500,
      bodyBudgetBytes: 20,
      autoSample: false,
    });
    const first = await admission.acquire(15);
    expect(first.ok).toBe(true);
    const waiting = admission.acquire(10);
    expect(admission.snapshot().queued).toBe(1);

    first.lease?.releaseBody();
    first.lease?.release();
    const second = await waiting;
    expect(second.ok).toBe(true);
    second.lease?.releaseBody();
    second.lease?.release();
    expect(admission.snapshot().bodyBytesInUse).toBe(0);
  });

  test("aborted and timed-out waiters do not leak queue entries", async () => {
    const admission = new RouterAdmission({
      hardMaxConcurrent: 1,
      initialConcurrent: 1,
      minConcurrent: 1,
      maxQueue: 2,
      queueWaitMs: 20,
      bodyBudgetBytes: 20,
      autoSample: false,
    });
    const first = await admission.acquire();
    const controller = new AbortController();
    const aborted = admission.acquire(1, controller.signal);
    controller.abort();
    expect(await aborted).toEqual({ ok: false, reason: "aborted" });
    expect(await admission.acquire(1)).toEqual({ ok: false, reason: "timeout" });
    first.lease?.releaseBody();
    first.lease?.release();
    expect(admission.snapshot().queued).toBe(0);
  });

  test("adaptive target rises gradually when saturated and healthy", async () => {
    const admission = new RouterAdmission({
      hardMaxConcurrent: 8,
      initialConcurrent: 2,
      minConcurrent: 1,
      maxQueue: 8,
      bodyBudgetBytes: 100,
      autoSample: false,
    });
    const first = await admission.acquire();
    const second = await admission.acquire();
    const before = admission.snapshot().currentLimit;
    admission.sample();
    admission.sample();
    expect(admission.snapshot().currentLimit).toBeGreaterThan(before);
    first.lease?.release();
    second.lease?.release();
  });

  test("gates critical RSS without ratcheting concurrency or blocking recovery", async () => {
    let rss = 10;
    const admission = new RouterAdmission({
      hardMaxConcurrent: 8,
      initialConcurrent: 4,
      minConcurrent: 1,
      maxQueue: 1,
      bodyBudgetBytes: 100,
      memoryHighWaterBytes: 70,
      memoryCriticalWaterBytes: 85,
      readRss: () => rss,
      autoSample: false,
    });

    const first = await admission.acquire();
    expect(first.ok).toBe(true);
    const before = admission.snapshot().currentLimit;

    rss = 95;
    admission.sample();
    expect(admission.snapshot().currentLimit).toBe(before);
    expect(await admission.acquire()).toEqual({ ok: false, reason: "memory_pressure" });

    rss = 10;
    admission.sample();
    const recovered = await admission.acquire();
    expect(recovered.ok).toBe(true);
    recovered.lease?.release();
    first.lease?.release();
  });

  test("automatic memory gates derive from machine capacity, not startup RSS", async () => {
    const capacityBytes = 16 * 1024 * 1024 * 1024;
    let rss = 1024 * 1024 * 1024;
    const admission = new RouterAdmission({
      hardMaxConcurrent: 8,
      initialConcurrent: 4,
      minConcurrent: 1,
      maxQueue: 1,
      bodyBudgetBytes: 100,
      memoryCapacityBytes: capacityBytes,
      readRss: () => rss,
      autoSample: false,
    });

    expect(admission.snapshot().memoryHighWaterBytes).toBe(
      Math.floor(capacityBytes * 0.7),
    );
    expect(admission.snapshot().memoryCriticalWaterBytes).toBe(
      Math.floor(capacityBytes * 0.85),
    );

    // Long-uptime growth far past the startup baseline must not gate the
    // router: only genuine machine capacity pressure may reject requests.
    rss = Math.floor(capacityBytes * 0.7) + 64 * 1024 * 1024;
    admission.sample();
    const admitted = await admission.acquire();
    expect(admitted.ok).toBe(true);
    admitted.lease?.release();

    // Crossing the critical water mark still rejects new requests.
    rss = Math.floor(capacityBytes * 0.85);
    expect(await admission.acquire()).toEqual({
      ok: false,
      reason: "memory_pressure",
    });
  });

  test("response completion and cancellation release the admission slot", async () => {
    const admission = new RouterAdmission({
      hardMaxConcurrent: 1,
      initialConcurrent: 1,
      minConcurrent: 1,
      maxQueue: 1,
      bodyBudgetBytes: 100,
      autoSample: false,
    });
    const completed = await admission.acquire(10);
    const response = wrapResponseWithAdmission(
      new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ok"));
          controller.close();
        },
      })),
      () => {
        completed.lease?.releaseBody();
        completed.lease?.release();
      },
    );
    await response.text();
    expect(admission.snapshot().active).toBe(0);
    expect(admission.snapshot().bodyBytesInUse).toBe(0);
  });

  test("uses weighted work units and drains a small request around a large waiter", async () => {
    const admission = new RouterAdmission({
      hardMaxConcurrent: 8,
      initialConcurrent: 8,
      minConcurrent: 1,
      maxQueue: 4,
      queueWaitMs: 500,
      bodyBudgetBytes: 100,
      autoSample: false,
    });
    const first = await admission.acquire(1, null, 6);
    expect(first.ok).toBe(true);
    const large = admission.acquire(1, null, 6);
    const small = admission.acquire(1, null, 1);
    expect(admission.snapshot().activeWorkUnits).toBe(7);
    expect((await small).ok).toBe(true);
    small.then((result) => result.lease?.release());
    first.lease?.release();
    expect((await large).ok).toBe(true);
    large.then((result) => result.lease?.release());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(admission.snapshot().activeWorkUnits).toBe(0);
  });
});
