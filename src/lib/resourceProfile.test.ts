import { describe, expect, test } from "bun:test";
import { deriveResourceProfile } from "./resourceProfile";

describe("automatic resource profile", () => {
  test("selects a bounded 2 GiB profile without env tuning", () => {
    const profile = deriveResourceProfile({ memoryBytes: 2 * 1024 ** 3, cpuCount: 2 });
    expect(profile.name).toBe("low-memory");
    expect(profile.initialConcurrent).toBe(24);
    expect(profile.maxConcurrent).toBe(96);
    expect(profile.maxConcurrentPerProvider).toBe(32);
    expect(profile.maxQueue).toBe(64);
    expect(profile.queueWaitMs).toBe(15_000);
    expect(profile.bodyBudgetMb).toBe(48);
    expect(profile.upstreamMaxAttempts).toBe(3);
  });

  test("scales the starting window down on a single vCPU", () => {
    const profile = deriveResourceProfile({ memoryBytes: 2 * 1024 ** 3, cpuCount: 1 });
    expect(profile.initialConcurrent).toBe(12);
    expect(profile.maxConcurrent).toBe(48);
    expect(profile.maxConcurrentPerProvider).toBe(16);
    expect(profile.minConcurrent).toBe(8);
  });

  test("allows an explicit profile when a host needs a different tradeoff", () => {
    const profile = deriveResourceProfile({ memoryBytes: 2 * 1024 ** 3, cpuCount: 2 }, "throughput");
    expect(profile.name).toBe("throughput");
    expect(profile.maxConcurrent).toBe(384);
    expect(profile.maxConcurrentPerProvider).toBe(96);
  });
});
