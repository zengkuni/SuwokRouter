import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env";

describe("runtime environment", () => {
  test("loads development compatibility defaults", () => {
    const config = loadEnv({ NODE_ENV: "development" });
    expect(config.port).toBe(14045);
    expect(config.hostname).toBe("127.0.0.1");
    expect(config.dataDir).toBe("");
    expect(config.baseUrl).toBe("");
    expect(config.jwtSecret).toBe("change-me");
    expect(config.nodeEnv).toBe("development");
    expect(config.usageHistoryRetentionDays).toBe(7);
    expect(config.usageHistoryMaxRows).toBe(500_000);
    expect(config.upstreamMaxAttempts).toBe(8);
  });

  test("loads bounded history and upstream retry overrides", () => {
    const config = loadEnv({
      NODE_ENV: "development",
      SWAY_USAGE_RETENTION_DAYS: "30",
      SWAY_USAGE_HISTORY_MAX_ROWS: "1200000",
      SWAY_UPSTREAM_MAX_ATTEMPTS: "4",
    });
    expect(config.usageHistoryRetentionDays).toBe(30);
    expect(config.usageHistoryMaxRows).toBe(1_200_000);
    expect(config.upstreamMaxAttempts).toBe(4);
  });

  test("derives an SSE-friendly queue wait from the selected resource profile", () => {
    const config = loadEnv({
      NODE_ENV: "production",
      JWT_SECRET: "j".repeat(40),
      API_KEY_SECRET: "k".repeat(40),
      SWAY_PERFORMANCE_PROFILE: "low-memory",
    });
    expect(config.routerQueueWaitMs).toBe(15_000);
  });

  test("rejects insecure production credentials", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow("JWT_SECRET");
    expect(() => loadEnv({
      NODE_ENV: "production",
      JWT_SECRET: "a".repeat(32),
    })).toThrow("API_KEY_SECRET");
  });

  test("accepts complete production configuration", () => {
    const config = loadEnv({
      NODE_ENV: "production",
      PORT: "18080",
      HOSTNAME: "10.0.0.5",
      JWT_SECRET: "j".repeat(40),
      API_KEY_SECRET: "k".repeat(40),
      INITIAL_PASSWORD: "ignored-password",
      TRUST_PROXY: "true",
      ENABLE_REQUEST_LOGS: "true",
      AUTH_COOKIE_SECURE: "true",
      BASE_URL: "https://router.example.com/",
      DATA_DIR: "./data",
      SWAY_METRICS_TOKEN: "metrics-secret",
      SWAY_METRICS_LOCAL: "0",
    });
    expect(config.port).toBe(18080);
    expect(config.hostname).toBe("10.0.0.5");
    expect(config.dataDir).toBe("./data");
    expect(config.baseUrl).toBe("https://router.example.com/");
    expect(config.initialPassword).toBe("123456");
    expect(config.trustProxy).toBe(true);
    expect(config.requestLogsEnabled).toBe(true);
    expect(config.requestLogsConfigured).toBe(true);
    expect(config.authCookieSecure).toBe(true);
    expect(config.metricsToken).toBe("metrics-secret");
    expect(config.metricsLocal).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("rejects invalid ports and environments", () => {
    expect(() => loadEnv({ NODE_ENV: "development", PORT: "0" })).toThrow("PORT");
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow("NODE_ENV");
    expect(() => loadEnv({ NODE_ENV: "development", HOSTNAME: "not a host" })).toThrow("HOSTNAME");
  });
});
