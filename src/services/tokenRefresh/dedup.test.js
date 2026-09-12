import { describe, expect, test, beforeEach } from "bun:test";
import {
  dedupRefresh,
  __getRefreshDedupSizeForTests,
  __resetRefreshDedupForTests,
} from "./dedup.js";

beforeEach(() => __resetRefreshDedupForTests());

describe("token refresh dedup cache", () => {
  test("keeps the cache bounded when many old tokens are seen", async () => {
    await Promise.all(Array.from({ length: 1100 }, (_, index) =>
      dedupRefresh("test", `old-token-${index}`, async () => ({ accessToken: `new-${index}` }))
    ));

    expect(__getRefreshDedupSizeForTests()).toBeLessThanOrEqual(1024);
  });
});
