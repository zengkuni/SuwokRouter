import { describe, expect, test } from "bun:test";
import { fetchOidcDiscovery, OIDC_FETCH_TIMEOUT_MS } from "./oidc.js";

describe("OIDC outbound request safety", () => {
  test("discovery fetch receives a bounded abort signal", async () => {
    const originalFetch = globalThis.fetch;
    let receivedOptions;
    globalThis.fetch = async (_url, options) => {
      receivedOptions = options;
      return new Response(JSON.stringify({ issuer: "https://issuer.example" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      await fetchOidcDiscovery("https://issuer.example");
      expect(receivedOptions?.signal).toBeInstanceOf(AbortSignal);
      expect(OIDC_FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
