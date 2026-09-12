import { describe, expect, test } from "bun:test";
import { POST } from "./route.js";

function request(body) {
  return new Request("http://localhost/api/chat/tools/router", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Sway Chat Router inspection tool", () => {
  test("returns a safe overview with provider counts and admission state", async () => {
    const response = await POST(request({ action: "overview" }));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.ok).toBe(true);
    expect(payload.kind).toBe("router_overview");
    expect(typeof payload.summary.totalModels).toBe("number");
    expect(typeof payload.summary.totalProviders).toBe("number");
    expect(payload.summary.totalProviders).toBeGreaterThanOrEqual(payload.summary.registeredProviderTypes);
    expect(typeof payload.summary.configuredProviders).toBe("number");
    expect(typeof payload.summary.activeProviders).toBe("number");
    expect(typeof payload.summary.inactiveOnlyProviders).toBe("number");
    expect(Array.isArray(payload.providerCounts)).toBe(true);
    expect(typeof payload.admission.currentLimit).toBe("number");
    expect(JSON.stringify(payload)).not.toMatch(/"apiKey"\s*:/);
    expect(JSON.stringify(payload)).not.toMatch(/"accessToken"\s*:/);
  });

  test("rejects an invalid result limit", async () => {
    const response = await POST(request({ action: "models", limit: 101 }));
    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
  });
});
