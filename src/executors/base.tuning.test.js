import { beforeEach, describe, expect, mock, test } from "bun:test";

let tuning = { timeoutMs: 60_000, maxAttempts: 8, streamTimeoutMs: 360_000 };
let calls = [];
let hangUntilAbort = false;

mock.module("@/lib/upstreamTuning.js", () => ({
  getUpstreamTuning: async () => tuning,
}));

mock.module(new URL("../utils/proxyFetch.js", import.meta.url).href, () => ({
  proxyAwareFetch: async (url, options) => {
    calls.push({ url, signal: options.signal });
    if (hangUntilAbort) {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
      });
    }
    return new Response("upstream failed", { status: 500 });
  },
}));

const { BaseExecutor } = await import("./base.js");

class FakeExecutor extends BaseExecutor {
  constructor() {
    super("fake", {
      baseUrl: "http://fake.local",
      retry: { 500: { attempts: 5, delayMs: 1 }, 502: { attempts: 5, delayMs: 1 } },
    });
  }

  buildHeaders() {
    return {};
  }
}


describe("BaseExecutor upstream tuning", () => {
  beforeEach(() => {
    calls = [];
    hangUntilAbort = false;
    tuning = { timeoutMs: 60_000, maxAttempts: 8, streamTimeoutMs: 360_000 };
  });

  test("settings max attempts caps total attempts", async () => {
    tuning = { timeoutMs: 60_000, maxAttempts: 2, streamTimeoutMs: 360_000 };
    const executor = new FakeExecutor();
    const result = await executor.execute({ model: "m", body: {}, stream: false, log: null });
    expect(result.response.status).toBe(500);
    expect(calls.length).toBe(2);
  });

  test("explicit maxTotalAttempts wins over settings", async () => {
    tuning = { timeoutMs: 60_000, maxAttempts: 5, streamTimeoutMs: 360_000 };
    const executor = new FakeExecutor();
    const result = await executor.execute({
      model: "m", body: {}, stream: false, log: null, maxTotalAttempts: 3,
    });
    expect(result.response.status).toBe(500);
    expect(calls.length).toBe(3);
  });

  test("settings connect timeout aborts a hanging attempt", async () => {
    tuning = { timeoutMs: 40, maxAttempts: 2, streamTimeoutMs: 360_000 };
    hangUntilAbort = true;
    const executor = new FakeExecutor();
    const startedAt = Date.now();
    await expect(executor.execute({ model: "m", body: {}, stream: false, log: null }))
      .rejects.toThrow(/fetch connect timeout/);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(40);
    expect(calls.length).toBe(2);
  });
});
