import { describe, expect, test } from "bun:test";
import { getPublicTunnelUrl, getTunnelHosts, isTunnelHost } from "./publicUrl.js";
import { getTunnelEnableError } from "./requirements.js";

describe("Cloudflare tunnel enable requirements", () => {
  test("requires API key, login, and a custom password", () => {
    expect(getTunnelEnableError({ requireApiKey: false, requireLogin: true, password: "hash" })).toContain("Require API key");
    expect(getTunnelEnableError({ requireApiKey: true, requireLogin: false, password: "hash" })).toContain("Require login");
    expect(getTunnelEnableError({ requireApiKey: true, requireLogin: true, password: "" })).toContain("custom dashboard password");
    expect(getTunnelEnableError({ requireApiKey: true, requireLogin: true, password: "hash" })).toBeNull();
  });
});

describe("Cloudflare tunnel public host", () => {
  test("derives the stable relay URL from the short id", () => {
    expect(getPublicTunnelUrl("AbC123")).toBe("https://rabc123.abc-tunnel.us");
  });

  test("matches both direct and stable relay hosts", () => {
    const settings = { tunnelEnabled: true, tunnelUrl: "https://quick.trycloudflare.com" };
    const state = { shortId: "abc123" };

    expect(getTunnelHosts(settings, state)).toEqual(
      new Set(["quick.trycloudflare.com", "rabc123.abc-tunnel.us"]),
    );
    expect(isTunnelHost("quick.trycloudflare.com:443", settings, state)).toBe(true);
    expect(isTunnelHost("rabc123.abc-tunnel.us", settings, state)).toBe(true);
    expect(isTunnelHost("other.example.com", settings, state)).toBe(false);
  });

  test("does not expose the relay host after the tunnel is disabled", () => {
    expect(isTunnelHost("rabc123.abc-tunnel.us", { tunnelEnabled: false }, { shortId: "abc123" })).toBe(false);
  });
});
