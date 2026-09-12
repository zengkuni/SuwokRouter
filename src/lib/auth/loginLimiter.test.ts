import { describe, expect, test, beforeEach } from "bun:test";
import {
  recordFail, recordSuccess, checkLock, __resetLoginLimiterForTests, __getLoginLimiterSizeForTests,
} from "./loginLimiter.js";
import { __resetMetricsForTests } from "@/observability/metrics.js";

const TEST_IP = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

beforeEach(() => {
  __resetLoginLimiterForTests();
  __resetMetricsForTests();
});

describe("loginLimiter: rapid bad login → temporary lock", () => {
  test("keeps unique failed-login sources bounded", () => {
    for (let i = 0; i < 10_100; i++) recordFail(`198.51.100.${i}`);
    expect(__getLoginLimiterSizeForTests()).toBeLessThanOrEqual(10_000);
  });

  test("5 recordFail → locked with retryAfter", () => {
    let last = null;
    for (let i = 0; i < 5; i++) last = recordFail(TEST_IP);
    expect(last?.locked, `5th fail locked`).toBe(true);
    expect(last?.retryAfter, `retryAfter present`).toBeGreaterThan(0);
    const lock = checkLock(TEST_IP);
    expect(lock.locked, `checkLock locked`).toBe(true);
    expect(lock.retryAfter, `checkLock retryAfter`).toBeGreaterThan(0);

  });

  test("recordSuccess clears lock", () => {
    for (let i = 0; i < 5; i++) recordFail(TEST_IP);
    expect(checkLock(TEST_IP).locked, `locked before success`).toBe(true);
    recordSuccess(TEST_IP);
    expect(checkLock(TEST_IP).locked, `unlocked after success`).toBe(false);
  });
});
