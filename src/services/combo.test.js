import { describe, expect, test } from "bun:test";
import { handleFusionChat } from "./combo.js";

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
