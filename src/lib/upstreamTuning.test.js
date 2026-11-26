import { describe, expect, test } from "bun:test";
import {
  normalizeUpstreamMaxAttempts,
  normalizeUpstreamStreamTimeoutMs,
  normalizeUpstreamTimeoutMs,
  resolveUpstreamTuning,
} from "./upstreamTuning.js";
import { env } from "@/lib/env";
import { FETCH_CONNECT_TIMEOUT_MS, STREAM_STALL_TIMEOUT_MS } from "@/config/runtimeConfig.js";

describe("upstream tuning", () => {
  test("null settings fall back to env defaults", () => {
    const { timeoutMs, maxAttempts, streamTimeoutMs } = resolveUpstreamTuning({
      upstreamTimeoutMs: null,
      upstreamMaxAttempts: null,
      upstreamStreamTimeoutMs: null,
    });
    expect(timeoutMs).toBe(FETCH_CONNECT_TIMEOUT_MS);
    expect(maxAttempts).toBe(env.upstreamMaxAttempts);
    expect(streamTimeoutMs).toBe(STREAM_STALL_TIMEOUT_MS);
  });

  test("settings override env defaults", () => {
    const { timeoutMs, maxAttempts, streamTimeoutMs } = resolveUpstreamTuning({
      upstreamTimeoutMs: 1_500,
      upstreamMaxAttempts: 2,
      upstreamStreamTimeoutMs: 120_000,
    });
    expect(timeoutMs).toBe(1_500);
    expect(maxAttempts).toBe(2);
    expect(streamTimeoutMs).toBe(120_000);
  });

  test("values are clamped to supported ranges", () => {
    expect(normalizeUpstreamTimeoutMs(1)).toBe(1_000);
    expect(normalizeUpstreamTimeoutMs(9_999_999)).toBe(600_000);
    expect(normalizeUpstreamMaxAttempts(0)).toBe(1);
    expect(normalizeUpstreamMaxAttempts(999)).toBe(100);
    expect(normalizeUpstreamTimeoutMs("")).toBeNull();
    expect(normalizeUpstreamMaxAttempts(undefined)).toBeNull();
    expect(normalizeUpstreamTimeoutMs("abc")).toBeNull();
    expect(normalizeUpstreamStreamTimeoutMs(1)).toBe(1_000);
    expect(normalizeUpstreamStreamTimeoutMs(9_999_999)).toBe(3_600_000);
    expect(normalizeUpstreamStreamTimeoutMs("")).toBeNull();
  });
});
