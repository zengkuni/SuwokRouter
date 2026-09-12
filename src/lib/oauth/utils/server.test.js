import { afterEach, describe, expect, test } from "bun:test";
import { request as undiciRequest } from "undici/index.js";
import {
  clearCodexSession,
  clearXaiSession,
  getCodexSessionStatus,
  getXaiSessionStatus,
  registerCodexSession,
  registerXaiSession,
  startLocalServer,
} from "./server.js";

afterEach(() => {
  clearCodexSession("oauth-test-state");
  clearCodexSession("oauth-test-state-2");
  clearXaiSession("oauth-test-xai-state");
});

describe("callback result page", () => {
  test("uses a white provider squircle and no manual close button", async () => {
    const { port, close } = await startLocalServer(() => {}, 0, "codex");
    try {
      const response = await undiciRequest(`http://127.0.0.1:${port}/callback?code=test`);
      const html = await response.body.text();
      expect(response.statusCode).toBe(200);
      expect(html).toContain('class="icon provider-icon"');
      expect(html).toContain("background:#fff");
      expect(html).not.toContain("Close window");
      expect(html).toContain("This window will close in");
    } finally {
      close();
    }
  });
});

describe("server-side OAuth session registration", () => {
  test("rejects incomplete Codex sessions", () => {
    expect(registerCodexSession({ state: "", codeVerifier: "v", redirectUri: "r" })).toBe(false);
    expect(registerCodexSession({ state: "s", codeVerifier: "", redirectUri: "r" })).toBe(false);
    expect(registerCodexSession({ state: "s", codeVerifier: "v", redirectUri: "" })).toBe(false);
  });

  test("stores and replaces a Codex session without exposing its status fields", () => {
    expect(registerCodexSession({
      state: "oauth-test-state",
      codeVerifier: "verifier-test",
      redirectUri: "http://localhost:1455/auth/callback",
    })).toBe(true);

    expect(getCodexSessionStatus("oauth-test-state")).toMatchObject({
      status: "pending",
      codeVerifier: "verifier-test",
      redirectUri: "http://localhost:1455/auth/callback",
    });

    expect(registerCodexSession({
      state: "oauth-test-state",
      codeVerifier: "replacement-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    })).toBe(true);
    expect(getCodexSessionStatus("oauth-test-state").codeVerifier).toBe("replacement-verifier");
  });

  test("keeps provider sessions isolated", () => {
    expect(registerCodexSession({
      state: "oauth-test-state-2",
      codeVerifier: "codex-verifier",
      redirectUri: "http://localhost:1455/auth/callback",
    })).toBe(true);
    expect(registerXaiSession({
      state: "oauth-test-xai-state",
      codeVerifier: "xai-verifier",
      redirectUri: "http://127.0.0.1:56121/callback",
    })).toBe(true);

    expect(getCodexSessionStatus("oauth-test-xai-state")).toBe(null);
    expect(getXaiSessionStatus("oauth-test-state-2")).toBe(null);
    expect(getXaiSessionStatus("oauth-test-xai-state")).toMatchObject({ status: "pending" });
  });

  test("clears a session explicitly", () => {
    registerCodexSession({
      state: "oauth-test-state",
      codeVerifier: "verifier-test",
      redirectUri: "http://localhost:1455/auth/callback",
    });
    clearCodexSession("oauth-test-state");
    expect(getCodexSessionStatus("oauth-test-state")).toBe(null);
  });
});
