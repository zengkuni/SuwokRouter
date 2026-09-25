import { describe, expect, test } from "bun:test";
import { handleComboChat, handleFusionChat } from "./combo.js";

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
