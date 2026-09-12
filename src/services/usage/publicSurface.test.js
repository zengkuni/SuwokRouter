import { describe, expect, test } from "bun:test";
import { formatKimiUsageError } from "./kimi.js";

describe("usage public error surface", () => {
  test("never returns provider-localized Kimi diagnostics", () => {
    const message = formatKimiUsageError(403, JSON.stringify({
      details: [{ debug: { reason: "REASON_FEATURE_NO_PERMISSION", localizedMessage: { message: "internal account id 123" } } }],
    }));
    expect(message).toBe("Kimi connected, but this account has no permission to view usage. Subscribe to Kimi Code to access quota.");
    expect(message).not.toContain("internal account id");
  });

  test("maps ordinary Kimi provider failures to status-only text", () => {
    expect(formatKimiUsageError(502, "upstream token=secret")).toBe("Kimi Coding usage API error (502).");
  });
});
