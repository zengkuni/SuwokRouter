import { describe, expect, test } from "bun:test";
import { coerceOpenAIJsonToSSE } from "./streamingHandler.js";

describe("streaming response compatibility", () => {
  test("converts a complete OpenAI JSON response into one-shot SSE", async () => {
    const response = await coerceOpenAIJsonToSSE(new Response(JSON.stringify({
      id: "chatcmpl-test",
      model: "muse-spark-1.3-contributor",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OK" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
    }), { headers: { "content-type": "application/json" } }), "fallback-model");

    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain('"content":"OK"');
    expect(body).toContain('"finish_reason":"stop"');
    expect(body.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(body).not.toContain("{\"id\":\"chatcmpl-test\",\"model\"");
  });

  test("leaves an existing SSE response untouched", async () => {
    const original = new Response("data: [DONE]\n\n", {
      headers: { "content-type": "text/event-stream" },
    });
    const response = await coerceOpenAIJsonToSSE(original, "fallback-model");
    expect(await response.text()).toBe("data: [DONE]\n\n");
  });

  test("normalizes any OpenAI-compatible full-completion SSE wrapper", async () => {
    const response = await coerceOpenAIJsonToSSE(new Response(
      `data: ${JSON.stringify({
        id: "chatcmpl-meta",
        model: "muse-spark-1.3-contributor",
        choices: [{ index: 0, message: { role: "assistant", content: "OK" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
      })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    ), "fallback-model", "custom-openai-compatible");

    const body = await response.text();
    expect(body).toContain('"content":"OK"');
    expect(body.match(/data: \[DONE\]/g)).toHaveLength(1);
  });
});
