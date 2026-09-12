import { describe, expect, test } from "bun:test";
import { getCacheDisplay } from "@/lib/cache-display";

describe("getCacheDisplay", () => {
  test("shows a hit and cache-read count", () => {
    const result = getCacheDisplay({ cachedTokens: 1234 });
    expect(result.hit).toBe(true);
    expect(result.label).toBe("HIT · 1.234");
    expect(result.title).toContain("1.234 tokens read");
  });

  test("shows cache creation alongside a hit", () => {
    const result = getCacheDisplay({ cachedTokens: 100, cacheCreationTokens: 25 });
    expect(result.label).toBe("HIT · 100 +25");
    expect(result.creationTokens).toBe(25);
  });

  test("shows a miss for absent or invalid values", () => {
    const result = getCacheDisplay({ cachedTokens: 0, cacheCreationTokens: NaN });
    expect(result.hit).toBe(false);
    expect(result.label).toBe("MISS");
    expect(result.title).toContain("no cached tokens read");
  });

  test("shows creation-only metadata as a miss", () => {
    const result = getCacheDisplay({ cacheCreationTokens: 64 });
    expect(result.label).toBe("MISS +64");
    expect(result.title).toContain("64 tokens created");
  });
});
