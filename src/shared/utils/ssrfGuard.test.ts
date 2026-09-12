import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  isUnsafeIp, assertPublicUrl, validatePublicUrl, assertPublicUrlAtDispatch,
  fetchWithSsrfGuard, SsrfGuardError, __resetSsrfCacheForTests,
} from "./ssrfGuard.js";

beforeEach(() => __resetSsrfCacheForTests());
afterEach(() => { __resetSsrfCacheForTests(); delete process.env.SSRF_ALLOW_PRIVATE; });

describe("ssrfGuard: isUnsafeIp classifier", () => {
  test("private IPv4 ranges all unsafe", () => {
    expect(isUnsafeIp("10.0.0.1"), `10/8`).toBe(true);
    expect(isUnsafeIp("172.16.0.1"), `172.16/12`).toBe(true);
    expect(isUnsafeIp("192.168.1.1"), `192.168/16`).toBe(true);
  });
  test("loopback + link-local unsafe", () => {
    expect(isUnsafeIp("127.0.0.1"), `loopback`).toBe(true);
    expect(isUnsafeIp("169.254.169.254"), `link-local`).toBe(true);
  });
  test("CGNAT 100.64.0.0/10 unsafe", () => {
    expect(isUnsafeIp("100.64.0.1"), `cgnat low`).toBe(true);
    expect(isUnsafeIp("100.127.255.254"), `cgnat high`).toBe(true);
    expect(isUnsafeIp("100.63.255.254"), `just-before cgnat safe`).toBe(false);
  });
  test("public IP safe", () => {
    expect(isUnsafeIp("8.8.8.8"), `8.8.8.8 safe`).toBe(false);
    expect(isUnsafeIp("1.1.1.1"), `1.1.1.1 safe`).toBe(false);
  });
  test("IPv6 loopback + link-local + unique-local unsafe", () => {
    expect(isUnsafeIp("::1"), `::1`).toBe(true);
    expect(isUnsafeIp("fe80::1"), `fe80/10 link-local`).toBe(true);
    expect(isUnsafeIp("fc00::1"), `fc00/7 unique-local`).toBe(true);
    expect(isUnsafeIp("ff02::1"), `ff00/8 multicast`).toBe(true);
  });
  test("IPv4-mapped IPv6 unsafe (delegated ke IPv4)", () => {
    expect(isUnsafeIp("::ffff:10.0.0.1"), `mapped private`).toBe(true);
    expect(isUnsafeIp("::ffff:127.0.0.1"), `mapped loopback`).toBe(true);
    expect(isUnsafeIp("::ffff:8.8.8.8"), `mapped public safe`).toBe(false);
  });
  test("NAT64 64:ff9b::/96 mapped private unsafe", () => {
    expect(isUnsafeIp("64:ff9b::10.0.0.1"), `nat64 private`).toBe(true);
    expect(isUnsafeIp("64:ff9b::8.8.8.8"), `nat64 public safe`).toBe(false);
  });
});

describe("ssrfGuard: assertPublicUrl (parse-time)", () => {
  test("private IPv4 literal blocked", () => {
    let err = null;
    try { assertPublicUrl("http://10.0.0.1/x"); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SsrfGuardError);
    expect((err as SsrfGuardError).reason, `blocked_ip`).toBe("blocked_ip");
  });
  test("loopback hostname + metadata hostname blocked", () => {
    expect(() => assertPublicUrl("http://localhost/x")).toThrow(SsrfGuardError);
    expect(() => assertPublicUrl("http://169.254.169.254/latest/meta-data")).toThrow(SsrfGuardError);
    expect(() => assertPublicUrl("http://metadata.google.internal/computeMetadata/v1")).toThrow(SsrfGuardError);
  });
  test("public URL passes", () => {
    const u = assertPublicUrl("https://api.anthropic.com/v1/messages");
    expect(u.hostname, `public host passed`).toBe("api.anthropic.com");
  });
  test("non-http scheme blocked", () => {
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow(SsrfGuardError);
    expect(() => assertPublicUrl("ftp://8.8.8.8/x")).toThrow(SsrfGuardError);
  });
});

describe("ssrfGuard: dispatch-time DNS rebinding + redirect-chain", () => {
  test("dispatch re-validates resolved private IP via mock resolver", async () => {

    const rebind = async () => [{ address: "10.0.0.99" }];
    let err = null;
    try {
      await assertPublicUrlAtDispatch("http://rebind.example.test/x", { label: "test", lookup: rebind });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SsrfGuardError);
    expect((err as SsrfGuardError).reason, `rebind → blocked_ip`).toBe("blocked_ip");
  });
  test("dispatch public-resolving host passes", async () => {
    const resolve = async () => [{ address: "8.8.8.8" }];
    const u = await assertPublicUrlAtDispatch("http://ok.example.test/x", { label: "test", lookup: resolve });
    expect(u.hostname, `passed`).toBe("ok.example.test");
  });
  test("redirect-chain ke private IP di-block pada hop-2", async () => {
    let call = 0;
    const fetcher = async () => {
      call++;
      if (call === 1) {
        return new Response(null, { status: 302, headers: { location: "http://10.0.0.1/secret" } });
      }
      return new Response("ok", { status: 200 });
    };
    let err = null;
    try {
      await fetchWithSsrfGuard("http://public.test/start", {}, { fetcher, lookup: async () => [{ address: "8.8.8.8" }] });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SsrfGuardError);
  });
  test("redirect-chain terlalu panjang → too-many-redirects", async () => {
    const fetcher = async () => new Response(null, { status: 302, headers: { location: "http://8.8.8.8/x" } });
    let err = null;
    try {
      await fetchWithSsrfGuard("http://8.8.8.8/start", {}, { fetcher, maxRedirects: 2 });
    } catch (e) { err = e; }
    expect(err).toBeInstanceOf(SsrfGuardError);
  });
});

describe("ssrfGuard: SSRF_ALLOW_PRIVATE opt-in", () => {
  test("opt-in allows private ranges (but metadata STILL blocked)", () => {
    process.env.SSRF_ALLOW_PRIVATE = "true";
    expect(() => assertPublicUrl("http://10.0.0.1/x"), `private allowed when opt-in`).not.toThrow();
    expect(() => assertPublicUrl("http://192.168.1.1/x"), `192.168 allowed`).not.toThrow();

    expect(() => assertPublicUrl("http://169.254.169.254/latest"), `metadata blocked opt-in`).toThrow(SsrfGuardError);
    expect(() => assertPublicUrl("http://metadata.google.internal/x"), `metadata.google.internal blocked opt-in`).toThrow(SsrfGuardError);
  });
  test("opt-in off (default) → private blocked", () => {
    expect(() => assertPublicUrl("http://10.0.0.1/x")).toThrow(SsrfGuardError);
  });
  test("validatePublicUrl returns message on failure (non-throw)", () => {
    const msg = validatePublicUrl("http://10.0.0.1/x");
    expect(typeof msg, `string message`).toBe("string");
    expect(validatePublicUrl("https://api.anthropic.com/x"), `public null`).toBe(null);
  });
});
