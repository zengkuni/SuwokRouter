import { describe, expect, test } from "bun:test";
import { __test__ } from "./route.js";

const { hasRequiredAuthorizationCodeFields, hasRequiredDevicePollFields, isPendingDevicePoll } = __test__;

describe("OAuth route flow validation", () => {
  test("accepts Antigravity's authorization code without a PKCE verifier", () => {
    expect(hasRequiredAuthorizationCodeFields("antigravity", "code", "http://localhost:14045/callback", null)).toBe(true);
  });

  test("requires a verifier for Claude's PKCE exchange", () => {
    expect(hasRequiredAuthorizationCodeFields("claude", "code", "http://localhost:14045/callback", null)).toBe(false);
    expect(hasRequiredAuthorizationCodeFields("claude", "code", "http://localhost:14045/callback", "verifier")).toBe(true);
  });

  test("accepts Grok CLI device polling without a verifier", () => {
    expect(hasRequiredDevicePollFields("grok-cli", "device-code", null)).toBe(true);
    expect(hasRequiredDevicePollFields("grok-build", "device-code", undefined)).toBe(true);
  });

  test("keeps Qoder's custom device verifier requirement", () => {
    expect(hasRequiredDevicePollFields("qoder", "device-code", null)).toBe(false);
    expect(hasRequiredDevicePollFields("qoder", "device-code", "verifier")).toBe(true);
  });

  test("normalizes both device pending responses", () => {
    expect(isPendingDevicePoll({ error: "authorization_pending" })).toBe(true);
    expect(isPendingDevicePoll({ error: "slow_down" })).toBe(true);
    expect(isPendingDevicePoll({ error: "access_denied" })).toBe(false);
  });
});
