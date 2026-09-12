import { afterEach, describe, expect, test } from "bun:test";
import { pingModelByKind } from "./ping.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function completionResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("pingModelByKind", () => {
  test("preserves successful completion validation", async () => {
    globalThis.fetch = (async () => completionResponse({
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
    })) as unknown as typeof fetch;

    const result = await pingModelByKind("test-model", "llm", "http://router");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
  });

  test("reports a body socket close as a failed model test", async () => {
    globalThis.fetch = (async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.error(Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }));
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;

    const result = await pingModelByKind("test-model", "llm", "http://router");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("response closed");
  });

  test("returns 504 with the configured deadline when the upstream hangs", async () => {
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) {
        reject(signal.reason || new DOMException("aborted", "AbortError"));
        return;
      }
      signal?.addEventListener("abort", () => {
        reject(signal.reason || new DOMException("aborted", "AbortError"));
      }, { once: true });
    })) as unknown as typeof fetch;

    const result = await pingModelByKind(
      "slow-model",
      "llm",
      "http://router",
      { timeoutMs: 20 },
    );
    expect(result).toMatchObject({
      ok: false,
      status: 504,
      error: "Model test timed out after 20ms",
    });
    expect(result.latencyMs).toBeGreaterThanOrEqual(15);
  });

  test("accepts a slow response that completes within its extended deadline", async () => {
    globalThis.fetch = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return completionResponse({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      });
    }) as unknown as typeof fetch;

    const result = await pingModelByKind(
      "slow-model",
      "llm",
      "http://router",
      { timeoutMs: 100 },
    );
    expect(result).toMatchObject({ ok: true, status: 200 });
  });

  test("does not turn caller cancellation into a model-test timeout", async () => {
    const caller = new AbortController();
    globalThis.fetch = (async (
      _input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => new Promise((_resolve, reject) => {
      const signal = init?.signal;
      signal?.addEventListener("abort", () => {
        reject(signal.reason || new DOMException("aborted", "AbortError"));
      }, { once: true });
      caller.abort(new Error("dashboard cancelled"));
    })) as unknown as typeof fetch;

    await expect(
      pingModelByKind("slow-model", "llm", "http://router", {
        timeoutMs: 100,
        signal: caller.signal,
      }),
    ).rejects.toThrow("dashboard cancelled");
  });

  test("accepts a successful SSE completion for streaming providers", async () => {
    let requestBody;
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response('data: {"choices":[{"delta":{"reasoning":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }) as unknown as typeof fetch;

    const result = await pingModelByKind("clinepass/glm-5.2", "llm", "http://router", { stream: true });
    expect(requestBody).toMatchObject({ model: "clinepass/glm-5.2", stream: true });
    expect(result).toMatchObject({ ok: true, status: 200 });
  });
});
