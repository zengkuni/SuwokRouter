import { describe, expect, test } from "bun:test";
import {
  PROVIDERS,
  generateAuthData,
  getProviderFlowType,
  providerRequiresDeviceCodeVerifier,
  providerUsesPkce,
  resolveProviderName,
} from "./index.js";

describe("OAuth flow contracts", () => {
  test("Claude is an authorization-code PKCE provider", () => {
    expect(getProviderFlowType("claude")).toBe("authorization_code_pkce");
    expect(providerUsesPkce("claude")).toBe(true);
  });

  test("Antigravity uses the bundled OAuth application client", async () => {
    expect(getProviderFlowType("antigravity")).toBe("authorization_code");
    expect(providerUsesPkce("antigravity")).toBe(false);

    const auth = await generateAuthData("antigravity", "http://localhost:14045/callback");
    const url = new URL(auth.authUrl);

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:14045/callback");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.has("code_challenge")).toBe(false);
    expect(url.searchParams.get("state")).toBe(auth.state);
    expect(auth.codeVerifier).toBeUndefined();
  });

  test("Antigravity sends the paired client credential during token exchange", async () => {
    const originalFetch = globalThis.fetch;
    let requestBody;

    globalThis.fetch = async (url, options) => {
      expect(url).toBe("https://oauth2.googleapis.com/token");
      requestBody = new URLSearchParams(options.body);
      return new Response(JSON.stringify({ access_token: "test-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    try {
      await PROVIDERS.antigravity.exchangeToken(
        PROVIDERS.antigravity.config,
        "test-code",
        "http://localhost:14045/callback",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(requestBody.get("grant_type")).toBe("authorization_code");
    expect(requestBody.get("client_id")).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(requestBody.get("client_secret")).toBeTruthy();
    expect(requestBody.get("code")).toBe("test-code");
    expect(requestBody.get("redirect_uri")).toBe("http://localhost:14045/callback");
    expect(requestBody.has("code_verifier")).toBe(false);
  });

  test("Grok Build aliases the no-PKCE Grok CLI device flow", () => {
    expect(resolveProviderName("grok-build")).toBe("grok-cli");
    expect(resolveProviderName("gb")).toBe("grok-cli");
    expect(getProviderFlowType("grok-build")).toBe("device_code");
    expect(providerUsesPkce("grok-cli")).toBe(false);
  });

  test("Qoder is the registered device flow with a verifier", () => {
    expect(providerRequiresDeviceCodeVerifier("qoder")).toBe(true);
  });
});
