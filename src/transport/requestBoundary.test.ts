import { describe, expect, test } from "bun:test";
import {
  downgradeH2c,
  estimateRequestWorkUnits,
  getRequestBodyLimitBytes,
  isQueryReadOnlyPath,
  normalizeQueryRequest,
  readRequestBodyWithLimit,
  queryCanonicalPath,
  rewritePublicAlias,
  stampClientIp,
} from "./requestBoundary";

describe("request boundary", () => {
  test("rewrites supported public aliases without losing query strings", () => {
    const request = rewritePublicAlias(new Request("http://localhost/v1/models?limit=5"));
    expect(new URL(request.url).pathname).toBe("/api/v1/models");
    expect(new URL(request.url).search).toBe("?limit=5");
    expect(request.headers.get("x-swayrouter-rewritten")).toBe("/api/v1/models");
  });

  test("handles double-v1 and responses aliases", () => {
    expect(new URL(rewritePublicAlias(new Request("http://localhost/v1/v1/models")).url).pathname).toBe("/api/v1/models");
    expect(new URL(rewritePublicAlias(new Request("http://localhost/codex")).url).pathname).toBe("/api/v1/responses");
    expect(new URL(rewritePublicAlias(new Request("http://localhost/codex/compact")).url).pathname).toBe("/api/v1/responses/compact");
    expect(new URL(rewritePublicAlias(new Request("http://localhost/responses")).url).pathname).toBe("/api/v1/responses");
    expect(new URL(rewritePublicAlias(new Request("http://localhost/responses/compact")).url).pathname).toBe("/api/v1/responses/compact");
    expect(queryCanonicalPath("/codex/compact")).toBe("/api/v1/responses/compact");
    expect(queryCanonicalPath("/responses/compact")).toBe("/api/v1/responses/compact");
  });

  test("rejects QUERY for write-oriented public aliases", () => {
    expect(isQueryReadOnlyPath("/codex/compact")).toBe(false);
    expect(isQueryReadOnlyPath("/responses/compact")).toBe(false);
    const query = new Request("http://localhost/codex/compact", { method: "QUERY" });
    expect(normalizeQueryRequest(query)).toBe(query);
  });

  test("returns malformed paths unchanged", () => {
    const request = new Request("http://localhost/other/path?x=1");
    expect(rewritePublicAlias(request)).toBe(request);
  });

  test("only normalizes read-only QUERY requests", async () => {
    expect(queryCanonicalPath("/v1/models")).toBe("/api/v1/models");
    expect(isQueryReadOnlyPath("/api/providers/catalog")).toBe(true);
    expect(isQueryReadOnlyPath("/api/v1/models")).toBe(false);
    const normalized = normalizeQueryRequest(new Request("http://localhost/api/providers/catalog?x=1", {
      method: "QUERY",
      headers: { "x-test": "yes" },
    }));
    expect(normalized.method).toBe("GET");
    expect(new URL(normalized.url).search).toBe("?x=1");
    expect(normalized.headers.get("x-swayrouter-query-method")).toBe("QUERY");
  });

  test("trusts forwarding headers only from loopback peers", () => {
    const local = new Request("http://localhost/", { headers: { "x-forwarded-for": "203.0.113.2" } });
    stampClientIp(local, "::ffff:127.0.0.1");
    expect(local.headers.get("x-swayrouter-real-ip")).toBe("203.0.113.2");
    expect(local.headers.get("x-forwarded-for")).toBeNull();

    const remote = new Request("http://localhost/", { headers: { "x-forwarded-for": "203.0.113.2" } });
    stampClientIp(remote, "198.51.100.4");
    expect(remote.headers.get("x-swayrouter-real-ip")).toBe("198.51.100.4");
  });

  test("downgrades h2c requests to ordinary HTTP semantics", () => {
    const request = new Request("http://localhost/", { headers: { upgrade: "h2c", "http2-settings": "abc" } });
    downgradeH2c(request);
    expect(request.headers.get("upgrade")).toBeNull();
    expect(request.headers.get("http2-settings")).toBeNull();
    expect(request.headers.get("connection")).toBe("close");
  });

  test("assigns bounded limits by request class", () => {
    expect(getRequestBodyLimitBytes("/api/v1/images/generations", "POST")).toBe(256 * 1024);
    expect(getRequestBodyLimitBytes("/api/v1/images/edits", "POST")).toBe(10 * 1024 * 1024);
    expect(getRequestBodyLimitBytes("/api/v1/chat/completions", "POST")).toBe(8 * 1024 * 1024);
    expect(getRequestBodyLimitBytes("/api/settings/migrate-9router", "POST")).toBe(25 * 1024 * 1024);
    expect(getRequestBodyLimitBytes("/api/providers", "POST")).toBe(1024 * 1024);
    expect(getRequestBodyLimitBytes("/api/providers", "GET")).toBe(0);
  });

  test("weights large bodies without letting them bypass the concurrency budget", () => {
    const small = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-length": "1024" },
      body: "x",
    });
    const large = new Request("http://localhost/v1/chat/completions", {
      method: "POST",
      headers: { "content-length": String(8 * 1024 * 1024) },
      body: "x",
    });
    expect(estimateRequestWorkUnits(small, 8 * 1024 * 1024)).toBe(1);
    expect(estimateRequestWorkUnits(large, 8 * 1024 * 1024)).toBe(8);
    expect(estimateRequestWorkUnits(new Request("http://localhost/v1/models"), 0)).toBe(1);
  });

  test("rejects declared oversized bodies before reading them", async () => {
    const result = await readRequestBodyWithLimit(new Request("http://localhost/api/providers", {
      method: "POST",
      headers: { "content-length": "101" },
      body: "x",
    }), 100);
    expect(result.tooLarge).toBe(true);
  });

  test("rebuilds an accepted body for downstream route handlers", async () => {
    const result = await readRequestBodyWithLimit(new Request("http://localhost/api/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    }), 1024);
    expect(result.tooLarge).toBe(false);
    expect(await result.request.json()).toEqual({ ok: true });
  });

  test("times out a body stream that never produces a chunk", async () => {
    const raw = new Request("http://localhost/api/providers", {
      method: "POST",
      body: new ReadableStream({}),
    });
    await expect(readRequestBodyWithLimit(raw, 1024, 10)).rejects.toMatchObject({
      code: "REQUEST_BODY_TIMEOUT",
    });
  });

  test("aborts a body read when the client disconnects", async () => {
    const controller = new AbortController();
    const raw = new Request("http://localhost/api/providers", {
      method: "POST",
      body: new ReadableStream({}),
      signal: controller.signal,
    });
    const pending = readRequestBodyWithLimit(raw, 1024, 1000);
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });
});
