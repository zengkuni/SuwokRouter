import { describe, expect, test } from "bun:test";
import {
  createRelayToken,
  isSupportedProxyType,
  normalizeRelayProjectName,
  publicProxyPool,
} from "./relay.js";

describe("managed relay helpers", () => {
  test("normalizes deployment names and rejects unsafe names", () => {
    expect(normalizeRelayProjectName("SwayRouter-Relay")).toBe("swayrouter-relay");
    expect(() => normalizeRelayProjectName("SwayRouter_Relay")).toThrow();
  });

  test("creates a high-entropy relay token", () => {
    const token = createRelayToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  });

  test("does not expose relay tokens in API pool objects", () => {
    expect(publicProxyPool({ id: "pool-1", relayToken: "secret", type: "cloudflare" })).toEqual({
      id: "pool-1",
      type: "cloudflare",
    });
  });

  test("supports only HTTP/SOCKS pools and managed relays", () => {
    expect(isSupportedProxyType("cloudflare")).toBe(true);
    expect(isSupportedProxyType("socks5")).toBe(true);
    expect(isSupportedProxyType("legacy")).toBe(false);
  });
});
