import { describe, expect, test } from "bun:test";
import { hasValidCliToken, isLocalRequest } from "./dashboardGuard.js";

describe("CLI token validation", () => {
  test("does not trust an arbitrary non-empty CLI header", async () => {
    const request = new Request("http://localhost/api/settings/database", {
      headers: { "x-suwokrouter-cli-token": "not-a-machine-token" },
    });
    expect(await hasValidCliToken(request)).toBe(false);
  });
});

describe("local request detection", () => {
  test("accepts a host peer that reached the container through a published port", () => {
    const request = new Request("http://localhost:1212/api/auth/login", {
      headers: {
        host: "localhost:1212",
        "x-suwokrouter-real-ip": "192.168.127.1",
        "x-suwokrouter-host-peer": "1",
      },
    });
    expect(isLocalRequest(request)).toBe(true);
  });

  test("accepts a loopback peer", () => {
    const request = new Request("http://127.0.0.1:1212/api/auth/login", {
      headers: { host: "127.0.0.1:1212", "x-suwokrouter-real-ip": "127.0.0.1" },
    });
    expect(isLocalRequest(request)).toBe(true);
  });

  test("rejects a remote peer that claims to be the host", () => {
    const request = new Request("http://localhost:1212/api/auth/login", {
      headers: {
        host: "localhost:1212",
        "x-suwokrouter-real-ip": "203.0.113.9",
      },
    });
    expect(isLocalRequest(request)).toBe(false);
  });

  test("rejects a host peer whose Host header was rewritten by a host-side proxy", () => {
    const request = new Request("http://192.168.1.10:1212/api/auth/login", {
      headers: {
        host: "192.168.1.10:1212",
        "x-suwokrouter-real-ip": "192.168.127.1",
        "x-suwokrouter-host-peer": "1",
      },
    });
    expect(isLocalRequest(request)).toBe(false);
  });

  test("rejects any request that arrived through a proxy", () => {
    const request = new Request("http://localhost:1212/api/auth/login", {
      headers: {
        host: "localhost:1212",
        "x-suwokrouter-real-ip": "192.168.127.1",
        "x-suwokrouter-host-peer": "1",
        "x-suwokrouter-via-proxy": "1",
      },
    });
    expect(isLocalRequest(request)).toBe(false);
  });
});
