import { describe, expect, test } from "bun:test";
import { getQuotaStatus } from "@/lib/quota-status";

describe("getQuotaStatus", () => {
  test("keeps CodeBuddy available when another package still has quota", () => {
    expect(getQuotaStatus("codebuddy-cn", [
      { remaining: 0 },
      { remaining: 13 },
      { remaining: 100 },
    ])).toBe("ok");
  });

  test("only marks CodeBuddy as limited when every package is exhausted", () => {
    expect(getQuotaStatus("codebuddy-cn", [
      { remaining: 0 },
      { remaining: 0 },
    ])).toBe("limit-reached");
  });

  test("keeps the all-windows policy for other providers", () => {
    expect(getQuotaStatus("claude", [
      { remaining: 0 },
      { remaining: 100 },
    ])).toBe("limit-reached");
  });

  test("does not treat unlimited quotas as exhausted", () => {
    expect(getQuotaStatus("codebuddy-cn", [
      { remaining: 0, unlimited: true },
    ])).toBe("ok");
  });
});
