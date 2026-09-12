import { describe, expect, test } from "bun:test";
import { resolveUsagePagination, shouldClampUsagePage } from "./usage-pagination";

describe("usage pagination", () => {
  test("keeps the requested page while the next page is loading", () => {
    expect(resolveUsagePagination(2)).toEqual({ safePage: 2, totalPages: 1 });
    expect(shouldClampUsagePage(2, undefined, true)).toBe(false);
  });

  test("clamps only after pagination metadata arrives", () => {
    const pagination = { totalPages: 1 };
    expect(resolveUsagePagination(2, pagination)).toEqual({ safePage: 1, totalPages: 1 });
    expect(shouldClampUsagePage(2, pagination, true)).toBe(false);
    expect(shouldClampUsagePage(2, pagination, false)).toBe(true);
  });

  test("does not clamp a valid page", () => {
    const pagination = { totalPages: 45 };
    expect(resolveUsagePagination(2, pagination)).toEqual({ safePage: 2, totalPages: 45 });
    expect(shouldClampUsagePage(2, pagination, false)).toBe(false);
  });
});
