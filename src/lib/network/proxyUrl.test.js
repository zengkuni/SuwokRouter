import { describe, expect, test } from "bun:test";
import {
  isSocksProxyUrl,
  normalizeProxyUrl,
  safeProxyError,
} from "./proxyUrl.js";

describe("proxy URL normalization", () => {
  test("preserves authenticated HTTP URLs and URL-encoded credentials", () => {
    const url = normalizeProxyUrl(
      "http://user%40region:pa%24%24@gateway.example.test:823",
      "http",
    );

    expect(url).toBe("http://user%40region:pa%24%24@gateway.example.test:823/");
    expect(new URL(url).username).toBe("user%40region");
    expect(new URL(url).password).toBe("pa%24%24");
  });

  test("adds HTTP to bare host and authenticated host values", () => {
    expect(normalizeProxyUrl("gateway.example.test:823", "http")).toBe(
      "http://gateway.example.test:823/",
    );
    expect(normalizeProxyUrl("user:password@gateway.example.test:823", "http")).toBe(
      "http://user:password@gateway.example.test:823/",
    );
  });

  test("uses the selected scheme for bare values", () => {
    expect(normalizeProxyUrl("gateway.example.test:443", "https")).toBe(
      "https://gateway.example.test/",
    );
    expect(normalizeProxyUrl("gateway.example.test:1080", "socks5")).toBe(
      "socks5://gateway.example.test:1080",
    );
    expect(normalizeProxyUrl("gateway.example.test:1080", "socks5h")).toBe(
      "socks5h://gateway.example.test:1080",
    );
  });

  test("identifies SOCKS proxies by type or URL", () => {
    expect(isSocksProxyUrl("gateway.example.test:1080", "socks5")).toBe(true);
    expect(isSocksProxyUrl("socks5h://gateway.example.test:1080", "http")).toBe(true);
    expect(isSocksProxyUrl("http://gateway.example.test:823", "http")).toBe(false);
  });

  test("rejects empty, malformed, unsupported, and unsafe values", () => {
    expect(normalizeProxyUrl("", "http")).toBeNull();
    expect(() => normalizeProxyUrl("socks5://gateway.example.test:1080", "http")).toThrow(
      "does not match URL scheme",
    );
    expect(() => normalizeProxyUrl("http:", "http")).toThrow("must include a host");
    expect(() => normalizeProxyUrl("ftp://gateway.example.test:21", "http")).toThrow(
      "must use http",
    );
    expect(() => normalizeProxyUrl("gateway.example.test:823\nX-Header: bad", "http")).toThrow(
      "invalid characters",
    );
  });
});

describe("proxy error redaction", () => {
  test("redacts credentials for every supported authenticated proxy scheme", () => {
    const error = new Error(
      "connect failed http://user:password@gateway.example.test:823 and socks5h://u:p@gateway.example.test:1080",
    );
    const safe = safeProxyError(error);

    expect(safe).toContain("http://[redacted]@gateway.example.test:823");
    expect(safe).toContain("socks5h://[redacted]@gateway.example.test:1080");
    expect(safe).not.toContain("user:password");
    expect(safe).not.toContain("u:p");
  });
});
