import { describe, expect, test } from "bun:test";
import { distinctModelIds, formatModelTestResult, runModelTests } from "@/lib/comboModelTest";

/** ES2022-compatible deferred (dashboard lib target has no Promise.withResolvers). */
function es2022Deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("formatModelTestResult", () => {
  test("labels a passing probe with its latency", () => {
    const result = formatModelTestResult({ ok: true, latencyMs: 4035.4, error: null, status: 200 });
    expect(result).toMatchObject({ ok: true, label: "OK · 4035ms", status: 200 });
  });

  test("labels a passing probe without latency", () => {
    const result = formatModelTestResult({ ok: true, latencyMs: null, error: null, status: 200 });
    expect(result.label).toBe("OK");
  });

  test("derives the error label from the numeric status", () => {
    const result = formatModelTestResult({
      ok: false,
      latencyMs: 12,
      error: "HTTP 404: No active credentials available",
      status: 404,
    });
    expect(result).toMatchObject({
      ok: false,
      label: "Error 404",
      message: "HTTP 404: No active credentials available",
      status: 404,
    });
  });

  test("recovers the status code embedded in the message", () => {
    expect(formatModelTestResult({ ok: false, error: "HTTP 503: upstream down" }).label).toBe("Error 503");
    expect(formatModelTestResult({ ok: false, error: "504 : gateway timeout" }).label).toBe("Error 504");
  });

  test("falls back to a bare Error label and keeps a readable message", () => {
    const result = formatModelTestResult({ ok: false, error: "boom" });
    expect(result).toMatchObject({ ok: false, label: "Error", message: "boom", status: null });
  });

  test("ignores a non-numeric status instead of printing it as a code", () => {
    const result = formatModelTestResult({ ok: false, error: "", status: "network error" });
    expect(result.label).toBe("Error");
    expect(result.message).toBe("Error");
    expect(result.status).toBe("network error");
  });

  test("never invents a latency label when the value is not finite", () => {
    expect(formatModelTestResult({ ok: true, latencyMs: Number.NaN }).label).toBe("OK");
  });
});

describe("distinctModelIds", () => {
  test("keeps the first occurrence and preserves order", () => {
    expect(distinctModelIds(["a", "b", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });

  test("drops blank ids", () => {
    expect(distinctModelIds(["a", "", "  ", "b"])).toEqual(["a", "b"]);
  });
});

describe("runModelTests", () => {
  test("probes at most four models at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const deferred = es2022Deferred<void>();
    const batch = runModelTests({
      targetIds: ["m1", "m2", "m3", "m4", "m5"],
      signal: new AbortController().signal,
      onProgress: () => {},
      run: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await deferred.promise;
        inFlight -= 1;
      },
    });
    await new Promise((resolve) => queueMicrotask(resolve));
    expect(inFlight).toBe(4);
    expect(peak).toBe(4);
    deferred.resolve();
    await batch;
    expect(peak).toBe(4);
  });

  test("stops starting probes once the signal aborts", async () => {
    const controller = new AbortController();
    const started: string[] = [];
    const progress: number[] = [];
    await runModelTests({
      targetIds: ["a", "b", "c", "d", "e", "f"],
      signal: controller.signal,
      onProgress: (settled) => progress.push(settled),
      run: async (modelId) => {
        started.push(modelId);
        controller.abort();
      },
    });
    expect(started).toEqual(["a"]);
    expect(progress).toEqual([1]);
  });

  test("keeps going when one probe rejects", async () => {
    const done: string[] = [];
    await runModelTests({
      targetIds: ["a", "b", "c"],
      signal: new AbortController().signal,
      onProgress: () => {},
      run: async (modelId) => {
        if (modelId === "b") throw new Error("transport exploded");
        done.push(modelId);
      },
    });
    expect(done.sort()).toEqual(["a", "c"]);
  });

  test("reports every settled probe exactly once", async () => {
    const progress: number[] = [];
    await runModelTests({
      targetIds: ["a", "b", "c"],
      signal: new AbortController().signal,
      onProgress: (settled) => progress.push(settled),
      run: async () => {},
    });
    expect(progress).toEqual([1, 2, 3]);
  });
});
