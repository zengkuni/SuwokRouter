import { describe, expect, test } from "bun:test";
import { POST } from "./route.js";
import { RUNTIME_CONFIG } from "@/shared/constants/config.js";
// The checkout-local .env may set SSRF_ALLOW_PRIVATE=true; this suite pins the
// default-off posture. assertPublicUrl reads the env per request, so a
// top-level override here applies before any test performs a fetch.
process.env.SSRF_ALLOW_PRIVATE = "false";
function request(body) {
  return new Request("http://localhost/api/chat/tools/curl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Suwok Chat curl tool", () => {
  test("blocks private, loopback, and metadata targets before fetch", async () => {
    for (const url of [
      "http://127.0.0.1:9999/",
      "http://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data",
      "http://metadata.google.internal/",
    ]) {
      const response = await POST(request({ url }));
      expect(response.status).toBe(400);
      expect((await response.json()).ok).toBe(false);
    }
  });

  test("lets the router curl its own API without the private-target block", async () => {
    const port = RUNTIME_CONFIG.appPort;

    const response = await POST(request({ url: `http://127.0.0.1:${port}/api/health/ready` }));
    // The self-URL exemption must run before the private-target checks; the
    // fetch itself may fail (nothing listening in CI), never the SSRF block.
    const body = await response.json();
    expect(body.error ?? "").not.toContain("Private");
    expect(body.error ?? "").not.toContain("loopback");
  });

  test("scopes writable methods to the router's own API", async () => {
    const remote = await POST(request({ url: "https://example.com/", method: "PUT", body: { a: 1 } }));
    expect(remote.status).toBe(400);
    expect((await remote.json()).error).toContain("only allowed against the router's own API");

    const getWithBody = await POST(request({ url: "https://example.com/", body: { a: 1 } }));
    expect(getWithBody.status).toBe(400);
    expect((await getWithBody.json()).error).toContain("cannot have a body");

    const badBody = await POST(request({ url: "https://example.com/", method: "PUT", body: "nope" }));
    expect(badBody.status).toBe(400);
    expect((await badBody.json()).error).toContain("body must be a JSON object");
  });
});
