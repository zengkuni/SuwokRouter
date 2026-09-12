import { describe, expect, test } from "bun:test";
import { testProxyUrl } from "./proxyTest.js";

describe("proxy health checks", () => {
  test("rejects an empty proxy URL before making a request", async () => {
    await expect(testProxyUrl({ proxyUrl: "" })).resolves.toEqual({
      ok: false,
      status: 400,
      error: "proxyUrl is required",
    });
  });

  test("rejects unsupported proxy schemes without network access", async () => {
    const result = await testProxyUrl({ proxyUrl: "ftp://proxy.example.test:21" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain("must use http");
  });
});
