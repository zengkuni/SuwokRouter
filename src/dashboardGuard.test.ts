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

  test("rejects a host-side proxy that forwards a remote client (via-proxy)", () => {
    // A reverse proxy on the host stamping x-forwarded-for is remote traffic
    // regardless of the Host header it forwards — including a private one.
    const request = new Request("http://192.168.1.10:1212/api/auth/login", {
      headers: {
        host: "192.168.1.10:1212",
        "x-suwokrouter-real-ip": "192.168.127.1",
        "x-suwokrouter-host-peer": "1",
        "x-suwokrouter-via-proxy": "1",
      },
    });
    expect(isLocalRequest(request)).toBe(false);
  });

  test("accepts the deployment's own LAN address through the host peer", () => {
    // docker published port; the user browses http://192.168.1.10:1212 on the
    // server's own LAN: peer is the gateway (host-peer) and Host is the box's
    // own LAN address → initial setup is allowed without any env config.
    const request = new Request("http://192.168.1.10:1212/api/auth/login", {
      headers: {
        host: "192.168.1.10:1212",
        "x-suwokrouter-real-ip": "172.21.0.1",
        "x-suwokrouter-host-peer": "1",
      },
    });
    expect(isLocalRequest(request)).toBe(true);
  });

  test("accepts a bare-metal LAN deployment (private host, private peer)", () => {
    // Source run on the server itself (or a custom docker network where the
    // peer is not the compose gateway): the client connects straight to the
    // box's LAN address, so both the Host and the peer are private.
    const request = new Request("http://192.168.1.10:12122/api/auth/login", {
      headers: {
        host: "192.168.1.10:12122",
        "x-suwokrouter-real-ip": "192.168.1.35",
      },
    });
    expect(isLocalRequest(request)).toBe(true);
  });

  test("rejects a private host claimed by a tunnel/proxy peer", () => {
    const request = new Request("http://192.168.1.10:1212/api/auth/login", {
      headers: {
        host: "192.168.1.10:1212",
        "x-suwokrouter-real-ip": "100.64.0.7",
      },
    });
    expect(isLocalRequest(request)).toBe(false);
  });

  test("rejects a private host when the peer is public (internet)", () => {
    const request = new Request("http://192.168.1.10:12122/api/auth/login", {
      headers: {
        host: "192.168.1.10:12122",
        "x-suwokrouter-real-ip": "203.0.113.9",
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

  test("accepts an operator-declared trusted local host", async () => {
    process.env.SUWOK_TRUSTED_LOCAL_HOSTS = "192.168.1.10,router.local";
    try {
      const request = new Request("http://192.168.1.10:12122/api/auth/login", {
        method: "POST",
        headers: { host: "192.168.1.10:12122" },
      });
      expect(isLocalRequest(request)).toBe(true);
      const viaName = new Request("http://router.local/api/auth/login", {
        method: "POST",
        headers: { host: "router.local" },
      });
      expect(isLocalRequest(viaName)).toBe(true);
    } finally {
      delete process.env.SUWOK_TRUSTED_LOCAL_HOSTS;
    }
  });

  test("still rejects an untrusted LAN address", async () => {
    const request = new Request("http://192.168.1.99:1212/api/auth/login", {
      method: "POST",
      headers: { host: "192.168.1.99:1212" },
    });
    expect(isLocalRequest(request)).toBe(false);
  });

  test("accepts a private host/peer with browser-style Origin and Referer", () => {
    // The real single-server deployment: browser at
    // http://192.168.1.10:12122 sends Host+Origin+Referer with the LAN
    // address, and the peer is the (private) docker network gateway.
    const request = new Request("http://192.168.1.10:12122/api/auth/login", {
      method: "POST",
      headers: {
        host: "192.168.1.10:12122",
        origin: "http://192.168.1.10:12122",
        referer: "http://192.168.1.10:12122/login",
        "x-suwokrouter-real-ip": "172.22.0.1",
        "user-agent": "Mozilla/5.0",
      },
    });
    expect(isLocalRequest(request)).toBe(true);
  });

});
