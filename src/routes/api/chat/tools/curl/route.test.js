import { describe, expect, test } from "bun:test";
import { POST } from "./route.js";

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
    const port = Number.parseInt(process.env.PORT || "1212", 10);
    const response = await POST(request({ url: `http://127.0.0.1:${port}/api/health/ready` }));
    // The self-URL exemption must run before the private-target checks; the
    // fetch itself may fail (nothing listening in CI), never the SSRF block.
    const body = await response.json();
    expect(body.error ?? "").not.toContain("Private");
    expect(body.error ?? "").not.toContain("loopback");
  });

  test("only permits bounded GET and HEAD requests", async () => {
    const response = await POST(
      request({ url: "https://example.com/", method: "POST" }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("GET and HEAD");
  });
});
