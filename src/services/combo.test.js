import { describe, expect, test } from "bun:test";
import {
  handleComboChat,
  handleFusionChat,
  recordModelLatency,
  getMeasuredLatency,
  getLatencyOrderedModels,
  planLatencyOrder,
  resetComboLatency,
  resolveMaxAccountAttempts,
} from "./combo.js";

const log = {
  info() {},
  warn() {},
};

function answer(text) {
  return new Response(JSON.stringify({
    choices: [{ message: { role: "assistant", content: text } }],
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("fusion cancellation", () => {
  test("aborts a panel that outlives the hard timeout", async () => {
    const aborted = [];
    const result = await handleFusionChat({
      body: { model: "combo", messages: [{ role: "user", content: "hello" }] },
      models: ["fast", "slow"],
      comboName: "audit",
      log,
      tuning: { minPanel: 2, stragglerGraceMs: 5, panelHardTimeoutMs: 20 },
      handleSingleModel: (_body, model, isPanel, signal) => {
        if (!isPanel) return Promise.resolve(answer("judge"));
        if (model === "fast") return Promise.resolve(answer("fast"));
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted.push(model);
            resolve(new Response(JSON.stringify({ error: "aborted" }), { status: 499 }));
          }, { once: true });
        });
      },
    });

    expect(result.status).toBe(200);
    expect(aborted).toEqual(["slow"]);
  });
});

describe("combo cancellation", () => {
  test("does not try another model after a cancelled response", async () => {
    const attempts = [];
    const result = await handleComboChat({
      body: { model: "combo", messages: [{ role: "user", content: "hello" }] },
      models: ["first", "second"],
      comboName: "cancel-test",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        return new Response(JSON.stringify({ error: "Request aborted" }), { status: 499 });
      },
    });

    expect(result.status).toBe(499);
    expect(attempts).toEqual(["first"]);
  });

  test("turns an aborted model error into a terminal cancellation response", async () => {
    const attempts = [];
    const result = await handleComboChat({
      body: { model: "combo", messages: [{ role: "user", content: "hello" }] },
      models: ["first", "second"],
      comboName: "abort-error-test",
      comboStrategy: "fallback",
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        throw new DOMException("The operation was aborted", "AbortError");
      },
    });

    expect(result.status).toBe(499);
    expect(attempts).toEqual(["first"]);
  });
});

describe("latency strategy", () => {
  test("orders measured models ascending, keeps unknown models after them", () => {
    resetComboLatency();
    recordModelLatency("slow", 900);
    recordModelLatency("fast", 120);
    recordModelLatency("mid", 400);

    expect(getLatencyOrderedModels(["slow", "unknown", "fast", "mid"])).toEqual([
      "fast",
      "mid",
      "slow",
      "unknown",
    ]);
  });

  test("keeps configured order when no model has a sample", () => {
    resetComboLatency();
    expect(getLatencyOrderedModels(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  test("tries the fastest measured model first and falls back in latency order", async () => {
    resetComboLatency();
    recordModelLatency("first", 800);
    recordModelLatency("second", 300);

    const attempts = [];
    const result = await handleComboChat({
      body: { model: "combo", messages: [{ role: "user", content: "hello" }] },
      models: ["first", "second", "cold"],
      comboName: "latency-test",
      comboStrategy: "latency",
      log,
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        if (model === "cold") return answer("cold wins");
        return new Response(JSON.stringify({ error: "upstream exploded" }), { status: 500 });
      },
    });

    expect(result.status).toBe(200);
    expect(attempts).toEqual(["second", "first", "cold"]);
  });

  test("a successful attempt updates the moving average used for ordering", async () => {
    resetComboLatency();
    recordModelLatency("known", 5000);

    await handleComboChat({
      body: { model: "combo", messages: [{ role: "user", content: "hello" }] },
      models: ["known"],
      comboName: "latency-record-test",
      comboStrategy: "latency",
      log,
      handleSingleModel: async () => answer("ok"),
    });

    const measured = getMeasuredLatency("known");
    expect(measured).toBeLessThan(5000);
    expect(measured).toBeGreaterThanOrEqual(0);
  });

  test("every tenth request probes a still-unmeasured model first", () => {
    resetComboLatency();
    recordModelLatency("fast", 100);
    recordModelLatency("slow", 900);
    const models = ["slow", "fast", "never-tried"];

    for (let i = 1; i <= 9; i++) {
      expect(planLatencyOrder(models, "probe-test")).toEqual({ models: ["fast", "slow", "never-tried"], explored: null });
    }

    expect(planLatencyOrder(models, "probe-test")).toEqual({
      models: ["never-tried", "fast", "slow"],
      explored: "never-tried",
    });
  });
});

describe("max account attempts", () => {
  test("0, blank, and invalid values mean unlimited", () => {
    expect(resolveMaxAccountAttempts(0)).toBe(0);
    expect(resolveMaxAccountAttempts("0")).toBe(0);
    expect(resolveMaxAccountAttempts("")).toBe(0);
    expect(resolveMaxAccountAttempts(undefined)).toBe(0);
    expect(resolveMaxAccountAttempts(-4)).toBe(0);
    expect(resolveMaxAccountAttempts("many")).toBe(0);
  });

  test("positive values are floored and capped", () => {
    expect(resolveMaxAccountAttempts(10)).toBe(10);
    expect(resolveMaxAccountAttempts("7.9")).toBe(7);
    expect(resolveMaxAccountAttempts(5000)).toBe(1000);
  });

  test("the limit is forwarded to every combo model attempt", async () => {
    const seen = [];
    const result = await handleComboChat({
      body: { model: "combo", messages: [{ role: "user", content: "hello" }] },
      models: ["first", "second"],
      comboName: "account-limit-test",
      comboStrategy: "fallback",
      maxAccountAttempts: 3,
      log,
      handleSingleModel: async (_body, model, limit) => {
        seen.push([model, limit]);
        if (model === "first") {
          return new Response(JSON.stringify({ error: "account attempt limit (3) reached" }), { status: 503 });
        }
        return answer("second wins");
      },
    });

    expect(result.status).toBe(200);
    expect(seen).toEqual([["first", 3], ["second", 3]]);
  });
});
