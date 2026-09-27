import { afterEach, describe, expect, it } from "bun:test";
import { fetchGrokSsoIdentity, sanitizeGrokSsoToken } from "./grokSsoAccount.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Grok SSO identity", () => {
  it("accepts a bare token, an sso= prefix, or a full cookie header", () => {
    expect(sanitizeGrokSsoToken("abc123")).toBe("abc123");
    expect(sanitizeGrokSsoToken("  sso=abc123\n")).toBe("abc123");
    expect(sanitizeGrokSsoToken("sso=abc123")).toBe("abc123");
    expect(sanitizeGrokSsoToken("cf_clearance=x; sso=abc123; other=1")).toBe("abc123");
    expect(sanitizeGrokSsoToken("")).toBe("");
  });

  it("reads the account email from the Grok session endpoint", async () => {
    let requestedUrl = "";
    let cookie = "";
    globalThis.fetch = async (url, options) => {
      requestedUrl = String(url);
      cookie = String(options.headers.Cookie);
      return Response.json({
        status: "authenticated",
        session: { userId: "u-1", email: "operator@example.com" },
        user: { id: "u-1", email: "operator@example.com" },
      });
    };

    const identity = await fetchGrokSsoIdentity("sso=abc123");

    expect(identity).toEqual({
      email: "operator@example.com",
      userId: "u-1",
      status: "authenticated",
    });
    expect(requestedUrl).toBe("https://grok.com/api/auth/session");
    expect(cookie).toBe("sso=abc123");
  });

  it("reports an unauthorized session instead of guessing an identity", async () => {
    globalThis.fetch = async () => new Response("", { status: 401 });
    const unauthorized = await fetchGrokSsoIdentity("abc123");
    expect(unauthorized).toEqual({ email: "", userId: "", status: "unauthorized" });
  });

  it("treats an unauthenticated payload as no identity", async () => {
    globalThis.fetch = async () => Response.json({ status: "unauthenticated", session: { email: "" } });
    const unauthenticated = await fetchGrokSsoIdentity("abc123");
    expect(unauthenticated).toMatchObject({ status: "unauthenticated", email: "" });
  });

  it("never throws when Grok is unreachable", async () => {
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    const unreachable = await fetchGrokSsoIdentity("abc123");
    expect(unreachable).toMatchObject({ status: "unreachable" });
  });

  it("skips the request entirely without a token", async () => {
    let called = false;
    globalThis.fetch = async () => {
      called = true;
      return Response.json({});
    };
    const missing = await fetchGrokSsoIdentity("   ");
    expect(missing).toMatchObject({ status: "missing-token" });
    expect(called).toBe(false);
  });
});
