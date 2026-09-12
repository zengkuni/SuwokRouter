import { describe, expect, test } from "bun:test";
import { hasValidCliToken } from "./dashboardGuard.js";

describe("CLI token validation", () => {
  test("does not trust an arbitrary non-empty CLI header", async () => {
    const request = new Request("http://localhost/api/settings/database", {
      headers: { "x-swayrouter-cli-token": "not-a-machine-token" },
    });
    expect(await hasValidCliToken(request)).toBe(false);
  });
});
