import { describe, expect, test, beforeEach } from "bun:test";
import { classifySSEEvent, isAuthError } from "./recovery.js";
import { __resetOAuthLeasesForTests, forceRefreshOAuth } from "./oauthLease.js";
import { FORMATS } from "../translator/formats.js";

beforeEach(() => __resetOAuthLeasesForTests());

describe("A4.3 classifySSEEvent", () => {
  test("OpenAI content delta → 'content' (the commit boundary)", () => {
    const parsed = {
      choices: [{ delta: { content: "Hello world" } }],
    };
    expect(classifySSEEvent(parsed, FORMATS.OPENAI)).toBe("content");
  });

  test("OpenAI reasoning_content delta → 'content'", () => {
    const parsed = {
      choices: [{ delta: { reasoning_content: "Thinking..." } }],
    };
    expect(classifySSEEvent(parsed, FORMATS.OPENAI)).toBe("content");
  });

  test("Claude content_block_delta with text → 'content'", () => {
    const parsed = {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "Hi" },
    };
    expect(classifySSEEvent(parsed, FORMATS.CLAUDE)).toBe("content");
  });

  test("Claude content_block_start with tool_use → 'content'", () => {
    const parsed = {
      type: "content_block_start",
      content_block: { type: "tool_use", id: "tool_1", name: "search", input: {} },
    };

    expect(classifySSEEvent(parsed, FORMATS.CLAUDE)).toBe("content");
  });

  test("error event → 'error'", () => {
    const parsed = { error: { message: "Internal error", code: "server_error" } };
    expect(classifySSEEvent(parsed, FORMATS.OPENAI)).toBe("error");
  });

  test("type=error event → 'error'", () => {
    const parsed = { type: "error", error: { type: "api_error", message: "Something broke" } };
    expect(classifySSEEvent(parsed, FORMATS.CLAUDE)).toBe("error");
  });

  test("error_code field → 'error'", () => {
    const parsed = { error_code: 500, error_message: "Server overloaded" };
    expect(classifySSEEvent(parsed, FORMATS.OPENAI)).toBe("error");
  });

  test("Gemini non-STOP finishReason → 'error'", () => {
    const parsed = { candidates: [{ finishReason: "SAFETY", content: { parts: [] } }] };
    expect(classifySSEEvent(parsed, FORMATS.GEMINI)).toBe("error");
  });

  test("Gemini STOP finishReason + empty parts → 'content' (hasValuableContent defaults true for non-Ollama)", () => {
    const parsed = { candidates: [{ finishReason: "STOP", content: { parts: [] } }] };

    expect(classifySSEEvent(parsed, FORMATS.GEMINI)).toBe("content");
  });

  test("done signal → 'neutral'", () => {
    expect(classifySSEEvent({ done: true }, FORMATS.OPENAI)).toBe("neutral");
  });

  test("null parsed → 'neutral'", () => {
    expect(classifySSEEvent(null, FORMATS.OPENAI)).toBe("neutral");
  });

  test("role delta (OpenAI first chunk) → 'content' (role signals assistant start)", () => {
    const parsed = { choices: [{ delta: { role: "assistant" } }] };

    expect(classifySSEEvent(parsed, FORMATS.OPENAI)).toBe("content");
  });

  test("Claude content_block_start (non-tool, non-delta) → 'content' (hasValuableContent returns true for non-Ollama)", () => {
    const parsed = { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } };
    expect(classifySSEEvent(parsed, FORMATS.CLAUDE)).toBe("content");
  });
});

describe("A4.3 isAuthError", () => {
  test("401 code → true", () => {
    expect(isAuthError({ error: { code: "401", message: "Unauthorized" } })).toBe(true);
  });

  test("authentication_error type → true", () => {
    expect(isAuthError({ error: { type: "authentication_error", message: "Bad key" } })).toBe(true);
  });

  test("'expired token' in message → true", () => {
    expect(isAuthError({ error: { message: "The access token has expired" } })).toBe(true);
  });

  test("'token_expired' in message → true", () => {
    expect(isAuthError({ error: { message: "token_expired: refresh required" } })).toBe(true);
  });

  test("server_error (500) → false (not an auth error)", () => {
    expect(isAuthError({ error: { code: "server_error", message: "Internal error" } })).toBe(false);
  });

  test("rate limit error → false", () => {
    expect(isAuthError({ error: { code: "rate_limit_exceeded", message: "Too many requests" } })).toBe(false);
  });

  test("null parsed → false", () => {
    expect(isAuthError(null)).toBe(false);
  });

  test("error with no error object → false", () => {
    expect(isAuthError({ type: "error", message: "bad" })).toBe(false);
  });
});

describe("A4.3 forceRefreshOAuth single-flight", () => {
  test("concurrent calls for same provider+connectionId coalesce into one refresh", async () => {

    const creds = { refreshToken: "rt_test", connectionId: "conn_1" };

    const p1 = forceRefreshOAuth("nonexistent-provider", creds, { debug: () => {} });
    const p2 = forceRefreshOAuth("nonexistent-provider", creds, { debug: () => {} });

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  test("different connectionId does NOT coalesce (separate lease)", async () => {
    const creds1 = { refreshToken: "rt_1", connectionId: "conn_A" };
    const creds2 = { refreshToken: "rt_2", connectionId: "conn_B" };

    const p1 = forceRefreshOAuth("nonexistent-provider", creds1, { debug: () => {} });
    const p2 = forceRefreshOAuth("nonexistent-provider", creds2, { debug: () => {} });

    expect(p1).not.toBe(p2);

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toBeNull();
    expect(r2).toBeNull();
  });

  test("lease does NOT coalesce for different providers", async () => {
    const creds = { refreshToken: "rt_3", connectionId: "conn_C" };

    const p1 = forceRefreshOAuth("nonexistent-provider-A", creds, { debug: () => {} });
    const p2 = forceRefreshOAuth("nonexistent-provider-B", creds, { debug: () => {} });

    expect(p1 === p2).toBe(false);

    await p1;
    await p2;
  });
});

describe("A4.3 createReplayStream", () => {

  test("yields prefix chunks first, then continues from rest reader", async () => {
    const { createReplayStream } = await import("./recovery.js");

    const prefix = [new TextEncoder().encode("AAA"), new TextEncoder().encode("BBB")];
    const restChunks = [new TextEncoder().encode("CCC"), new TextEncoder().encode("DDD")];
    let restIndex = 0;

    const mockReader = {
      read() {
        if (restIndex < restChunks.length) {
          return Promise.resolve({ done: false, value: restChunks[restIndex++] });
        }
        return Promise.resolve({ done: true });
      },
      cancel() { return Promise.resolve(); }
    };

    const stream = createReplayStream(prefix, mockReader as any);
    const reader = stream.getReader();
    const chunks: string[] = [];
    const dec = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(dec.decode(value));
    }

    expect(chunks).toEqual(["AAA", "BBB", "CCC", "DDD"]);
  });
});
