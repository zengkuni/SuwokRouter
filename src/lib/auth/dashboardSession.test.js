import { describe, expect, test } from "bun:test";
import {
  createDashboardAuthToken,
  getDashboardAuthSession,
  shouldUseSecureCookie,
} from "./dashboardSession.js";

describe("dashboard session cookie transport", () => {
  test("does not trust forwarded protocol from an untrusted request", () => {
    const request = new Request("http://router.test/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(shouldUseSecureCookie(request)).toBe(false);
  });

  test("preserves the forced password-change claim in the session", async () => {
    const token = await createDashboardAuthToken({ mustChangePassword: true });
    const session = await getDashboardAuthSession(token);
    expect(session?.mustChangePassword).toBe(true);
  });
});

export {};
