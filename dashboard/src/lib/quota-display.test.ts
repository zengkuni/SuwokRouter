import { describe, expect, test } from "bun:test";
import {
  getHiddenQuotaCount,
  getVisibleQuotas,
  QUOTA_COLLAPSED_LIMIT,
  shouldShowQuotaDisclosure,
} from "./quota-display";

describe("quota display helpers", () => {
  test("shows only the collapsed quota window", () => {
    const quotas = ["one", "two", "three", "four", "five"];

    expect(getVisibleQuotas(quotas, false)).toEqual([
      "one",
      "two",
      "three",
    ]);
    expect(getHiddenQuotaCount(quotas)).toBe(2);
    expect(shouldShowQuotaDisclosure(quotas)).toBe(true);
  });

  test("shows every quota when expanded", () => {
    const quotas = ["one", "two", "three", "four"];

    expect(getVisibleQuotas(quotas, true)).toEqual(quotas);
  });

  test("does not require disclosure for short lists", () => {
    for (const size of [0, 1, QUOTA_COLLAPSED_LIMIT]) {
      const quotas = Array.from({ length: size }, (_, i) => `quota-${i}`);

      expect(getVisibleQuotas(quotas, false)).toEqual(quotas);
      expect(getVisibleQuotas(quotas, true)).toEqual(quotas);
      expect(getHiddenQuotaCount(quotas)).toBe(0);
      expect(shouldShowQuotaDisclosure(quotas)).toBe(false);
    }
  });
});
