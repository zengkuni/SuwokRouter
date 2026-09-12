import { describe, expect, mock, test } from "bun:test";
import { generateAuthData } from "./index.js";

mock.module("../utils/pkce.js", () => ({
  generatePKCE: () => ({
    codeVerifier: "verifier-test",
    codeChallenge: "challenge-test",
    state: "state-test",
  }),
}));

describe("Codex OAuth contract", () => {
  test("builds the registered callback and PKCE authorization parameters", async () => {
    const auth = await generateAuthData(
      "codex",
      "http://localhost:1455/auth/callback",
    );
    const url = new URL(auth.authUrl);

    expect(url.origin + url.pathname).toBe("https://auth.openai.com/oauth/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:1455/auth/callback");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-test");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-test");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(auth.codeVerifier).toBe("verifier-test");
  });
});
