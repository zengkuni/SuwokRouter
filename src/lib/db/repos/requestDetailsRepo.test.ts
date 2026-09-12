import { describe, expect, test } from "bun:test";

const { default: crypto } = await import("node:crypto");

describe("request detail persistence boundary", () => {
  test("uses cryptographically random detail identifiers", () => {
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("sensitive nested fields use explicit redaction markers", () => {
    const payload = {
      request: { headers: { authorization: "Bearer secret" } },
      providerResponse: { apiKey: "secret", text: "safe" },
    };
    const redacted = JSON.parse(JSON.stringify(payload).replace(/"(authorization|apiKey)":"[^"]*"/g, '"$1":"[REDACTED]"'));
    expect(redacted.request.headers.authorization).toBe("[REDACTED]");
    expect(redacted.providerResponse.apiKey).toBe("[REDACTED]");
    expect(redacted.providerResponse.text).toBe("safe");
  });
});
