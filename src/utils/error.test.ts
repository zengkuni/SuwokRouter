import { describe, expect, test } from "bun:test";
import { parseUpstreamError, formatProviderError } from "./error.js";

describe("parseUpstreamError", () => {
  test("preserves upstream error body", async () => {
    const response = new Response(JSON.stringify({ error: { message: "Unknown parameter: reasoning_effort" } }), { status: 400 });
    const result = await parseUpstreamError(response, null);
    expect(result.message).toBe("Unknown parameter: reasoning_effort");
  });

  test("extracts inner message when executor returns raw JSON body", async () => {
    const body = JSON.stringify({ error: { code: "content-blocked", message: "content-blocked (request id: x)" } });
    const executor = {
      parseError: (response: Response, bodyText: string) => ({ status: response.status, message: bodyText }),
    };
    const result = await parseUpstreamError(new Response(body, { status: 400 }), executor);
    expect(result.message).toBe("content-blocked (request id: x)");
  });
});

describe("formatProviderError", () => {
  test("preserves upstream 4xx message instead of generic 'Bad request'", () => {
    const msg = formatProviderError(new Error("content-blocked (request id: abc)"), "agentrouter", "deepseek-v4-flash", 400);
    expect(msg).toContain("content-blocked");
  });
  test("still masks auth and rate-limit errors", () => {
    expect(formatProviderError(new Error("secret token detail"), "p", "m", 401)).toBe("Invalid API key provided");
    expect(formatProviderError(new Error("secret"), "p", "m", 429)).toBe("Rate limit exceeded");
  });
  test("falls back to default when upstream message is empty", () => {
    expect(formatProviderError(new Error(""), "p", "m", 400)).toBe("Bad request");
  });
});
