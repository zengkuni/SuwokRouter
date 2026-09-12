import { describe, expect, test } from "bun:test";
import { getOAuthRedirectUri, usesConnectionModelCatalog } from "./connections-api";

describe("OAuth redirect routing", () => {
  test("uses the same loopback host as the dashboard", () => {
    expect(
      getOAuthRedirectUri("antigravity", {
        protocol: "http:",
        hostname: "localhost",
        port: "14045",
      }),
    ).toBe("http://localhost:14045/callback");

    expect(
      getOAuthRedirectUri("antigravity", {
        protocol: "http:",
        hostname: "127.0.0.1",
        port: "14045",
      }),
    ).toBe("http://127.0.0.1:14045/callback");
  });

  test("keeps public hosts on the canonical local callback", () => {
    expect(
      getOAuthRedirectUri("antigravity", {
        protocol: "https:",
        hostname: "router.example.com",
        port: "443",
      }),
    ).toBe("http://localhost:443/callback");
  });
});

describe("provider model catalog routing", () => {
  test("passthrough providers use the connection-scoped upstream catalog", () => {
    expect(usesConnectionModelCatalog({ passthroughModels: true })).toBe(true);
  });

  test("custom nodes and ordinary providers keep their existing behavior", () => {
    expect(usesConnectionModelCatalog({ isCustom: true })).toBe(true);
    expect(usesConnectionModelCatalog({ nodeType: "openai-compatible" })).toBe(true);
    expect(usesConnectionModelCatalog({})).toBe(false);
    expect(usesConnectionModelCatalog(null)).toBe(false);
  });
});
