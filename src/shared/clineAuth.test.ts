import { describe, expect, test } from "bun:test";
import { DefaultExecutor } from "../executors/default.js";
import {
  buildClineHeaders,
  getClineAccessToken,
  getClineAuthorizationHeader,
} from "./clineAuth.js";

describe("Cline authentication headers", () => {
  test("prefixes OAuth access tokens with workos", () => {
    expect(getClineAccessToken("oauth-token")).toBe("workos:oauth-token");
    expect(getClineAuthorizationHeader("oauth-token")).toBe("Bearer workos:oauth-token");
  });

  test("does not duplicate an existing WorkOS prefix", () => {
    expect(getClineAccessToken("workos:oauth-token")).toBe("workos:oauth-token");
  });

  test("builds Cline OAuth headers without exposing the raw token elsewhere", () => {
    const headers = buildClineHeaders("oauth-token") as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer workos:oauth-token");
    expect(headers["X-CLIENT-TYPE"]).toBe("swayrouter");
  });

  test("sends ClinePass API keys as plain Bearer tokens", () => {
    const executor = new DefaultExecutor("clinepass");
    const headers = executor.buildHeaders({ apiKey: "cp-api-key" }, false);
    expect(headers.Authorization).toBe("Bearer cp-api-key");
    expect(headers.Authorization).not.toContain("workos:");
  });

  test("keeps ClinePass OAuth tokens on the WorkOS path", () => {
    const executor = new DefaultExecutor("clinepass");
    const headers = executor.buildHeaders({ accessToken: "oauth-token" }, false);
    expect(headers["Authorization"]).toBe("Bearer workos:oauth-token");
  });
});
