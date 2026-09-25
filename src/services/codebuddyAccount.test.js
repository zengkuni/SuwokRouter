import { afterEach, describe, expect, it } from "bun:test";
import {
  isCodeBuddyAccountProvider,
  resolveCodeBuddyIdentity,
} from "./codebuddyAccount.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function tokenFor(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

describe("CodeBuddy account identity", () => {
  it("recognizes the CodeBuddy providers", () => {
    expect(isCodeBuddyAccountProvider("codebuddy-cn")).toBe(true);
    expect(isCodeBuddyAccountProvider("codebuddy-intl")).toBe(true);
    expect(isCodeBuddyAccountProvider("codex")).toBe(false);
  });

  it("collects email and name from the real /v2/accounts response", async () => {
    const token = tokenFor({ sub: "user-42", email: "jwt@example.com" });
    let requestedUrl = "";
    let authorization = "";

    globalThis.fetch = async (url, options) => {
      requestedUrl = String(url);
      authorization = String(options.headers.Authorization);
      return Response.json({
        code: 0,
        data: {
          data: {
            accounts: [
              { uid: "user-7", nickname: "Other", pluginEnabled: true, lastLogin: true },
              { uid: "user-42", nickname: "Budi", email: "budi@example.com", pluginEnabled: true },
            ],
          },
        },
      });
    };

    const identity = await resolveCodeBuddyIdentity("codebuddy-intl", token);

    expect(requestedUrl).toBe("https://www.codebuddy.ai/v2/accounts");
    expect(authorization).toBe(`Bearer ${token}`);
    expect(identity).toEqual({
      email: "budi@example.com",
      name: "Budi",
      source: "accounts",
    });
  });

  it("falls back to the token claims when the account list is unavailable", async () => {
    globalThis.fetch = async () => new Response("nope", { status: 500 });
    const token = tokenFor({
      sub: "user-9",
      email: "fallback@example.com",
      name: "Fallback Name",
    });

    await expect(resolveCodeBuddyIdentity("codebuddy-cn", token)).resolves.toEqual({
      email: "fallback@example.com",
      name: "Fallback Name",
      source: "token",
    });
  });

  it("returns an empty identity when the token is missing", async () => {
    const identity = await resolveCodeBuddyIdentity("codebuddy-cn", "");
    expect(identity).toEqual({ email: "", name: "", source: "none" });
  });
});
