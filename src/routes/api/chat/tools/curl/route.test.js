import { describe, expect, test } from "bun:test";
import { POST } from "./route.js";

function request(body) {
  return new Request("http://localhost/api/chat/tools/curl", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Sway Chat curl tool", () => {
  test("blocks private, loopback, and metadata targets before fetch", async () => {
    for (const url of ["http://127.0.0.1:14045/", "http://[::ffff:127.0.0.1]/", "http://169.254.169.254/latest/meta-data", "http://metadata.google.internal/"]) {
      const response = await POST(request({ url }));
      expect(response.status).toBe(400);
      expect((await response.json()).ok).toBe(false);
    }
  });

  test("only permits bounded GET and HEAD requests", async () => {
    const response = await POST(request({ url: "https://example.com/", method: "POST" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("GET and HEAD");
  });
});
