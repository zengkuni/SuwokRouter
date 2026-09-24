import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env";

describe("runtime environment", () => {
  test("loads development compatibility defaults", () => {
    const config = loadEnv({ NODE_ENV: "development" });
    expect(config.port).toBe(1212);
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
      SUWOK_USAGE_RETENTION_DAYS: "30",
      SUWOK_USAGE_HISTORY_MAX_ROWS: "1200000",
      SUWOK_UPSTREAM_MAX_ATTEMPTS: "4",
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
      SUWOK_PERFORMANCE_PROFILE: "low-memory",
    });
    expect(config.routerQueueWaitMs).toBe(15_000);
  });

  test("rejects insecure production credentials", () => {
    expect(() => loadEnv({ NODE_ENV: "production" })).toThrow("JWT_SECRET");
    expect(() =>
      loadEnv({
        NODE_ENV: "production",
        JWT_SECRET: "a".repeat(32),
      }),
    ).toThrow("API_KEY_SECRET");
  });

  test("accepts complete production configuration", () => {
    const config = loadEnv({
      NODE_ENV: "production",
      PORT: "18080",
      HOSTNAME: "10.0.0.5",
      JWT_SECRET: "j".repeat(40),
      API_KEY_SECRET: "k".repeat(40),
      INITIAL_PASSWORD: "production-first-boot-secret",
      TRUST_PROXY: "true",
      ENABLE_REQUEST_LOGS: "true",
      AUTH_COOKIE_SECURE: "true",
      BASE_URL: "https://router.example.com/",
      DATA_DIR: "./data",
      SUWOK_METRICS_TOKEN: "metrics-secret",
      SUWOK_METRICS_LOCAL: "0",
    });
    expect(config.port).toBe(18080);
    expect(config.hostname).toBe("10.0.0.5");
    expect(config.dataDir).toBe("./data");
    expect(config.baseUrl).toBe("https://router.example.com/");
    expect(config.initialPassword).toBe("production-first-boot-secret");
    expect(config.trustProxy).toBe(true);
    expect(config.requestLogsEnabled).toBe(true);
    expect(config.requestLogsConfigured).toBe(true);
    expect(config.authCookieSecure).toBe(true);
    expect(config.metricsToken).toBe("metrics-secret");
    expect(config.metricsLocal).toBe(false);
    expect(Object.isFrozen(config)).toBe(true);
  });

  test("falls back to the default initial password when unset or blank", () => {
    expect(loadEnv({ NODE_ENV: "development" }).initialPassword).toBe("123456");
    expect(loadEnv({ NODE_ENV: "development", INITIAL_PASSWORD: "   " }).initialPassword).toBe("123456");
  });

  test("trims whitespace around INITIAL_PASSWORD", () => {
    expect(
      loadEnv({ NODE_ENV: "development", INITIAL_PASSWORD: "  spaced-secret  " }).initialPassword,
    ).toBe("spaced-secret");
  });

  test("rejects invalid ports and environments", () => {
    expect(() => loadEnv({ NODE_ENV: "development", PORT: "0" })).toThrow(
      "PORT",
    );
    expect(() => loadEnv({ NODE_ENV: "staging" })).toThrow("NODE_ENV");
    expect(() =>
      loadEnv({ NODE_ENV: "development", HOSTNAME: "not a host" }),
    ).toThrow("HOSTNAME");
  });
});

describe("database and cache environment", () => {
  test("leaves database fields unset when no DB configuration is provided", () => {
    const config = loadEnv({ NODE_ENV: "development" });
    expect(config.dbUrl).toBe("");
    expect(config.dbHost).toBe("");
    expect(config.dbPort).toBe(5432);
    expect(config.dbUser).toBe("");
    expect(config.dbPassword).toBe("");
    expect(config.dbName).toBe("");
    expect(config.dbSsl).toBe(false);
    expect(config.redisUrl).toBe("");
    expect(config.redisEnabled).toBe(false);
  });

  test("parses DB_URL into individual fields", () => {
    const config = loadEnv({
      NODE_ENV: "development",
      DB_URL: "postgres://router:secret@db.internal:6432/suwokrouter",
    });
    expect(config.dbUrl).toBe("postgres://router:secret@db.internal:6432/suwokrouter");
    expect(config.dbHost).toBe("db.internal");
    expect(config.dbPort).toBe(6432);
    expect(config.dbUser).toBe("router");
    expect(config.dbPassword).toBe("secret");
    expect(config.dbName).toBe("suwokrouter");
    expect(config.dbSsl).toBe(false);
  });

  test("enables ssl when the URL asks for sslmode=require", () => {
    const config = loadEnv({
      NODE_ENV: "development",
      DB_URL: "postgres://router:secret@db.internal:5432/suwokrouter?sslmode=require",
    });
    expect(config.dbHost).toBe("db.internal");
    expect(config.dbSsl).toBe(true);
  });

  test("lets split POSTGRES_* fields override DB_URL components", () => {
    const config = loadEnv({
      NODE_ENV: "development",
      DB_URL: "postgres://router:secret@db.internal:5432/suwokrouter",
      POSTGRES_HOST: "override.internal",
      POSTGRES_PORT: "7432",
      POSTGRES_USER: "other",
      POSTGRES_PASSWORD: "pw2",
      POSTGRES_DB: "otherdb",
    });
    expect(config.dbHost).toBe("override.internal");
    expect(config.dbPort).toBe(7432);
    expect(config.dbUser).toBe("other");
    expect(config.dbPassword).toBe("pw2");
    expect(config.dbName).toBe("otherdb");
  });

  test("accepts DB_* aliases for the split fields", () => {
    const config = loadEnv({
      NODE_ENV: "development",
      DB_HOST: "alias.internal",
      DB_PORT: "8432",
      DB_USER: "aliasuser",
      DB_PASSWORD: "pw3",
      DB_NAME: "aliasdb",
    });
    expect(config.dbHost).toBe("alias.internal");
    expect(config.dbPort).toBe(8432);
    expect(config.dbUser).toBe("aliasuser");
    expect(config.dbPassword).toBe("pw3");
    expect(config.dbName).toBe("aliasdb");
  });

  test("treats DB_URL as absent when it is blank or not a postgres scheme", () => {
    expect(loadEnv({ NODE_ENV: "development", DB_URL: "" }).dbHost).toBe("");
    expect(loadEnv({ NODE_ENV: "development", DB_URL: "sqlite://x/y" }).dbHost).toBe("");
  });

  test("enables redis only when REDIS_URL is set", () => {
    expect(loadEnv({ NODE_ENV: "development", REDIS_URL: "" }).redisEnabled).toBe(false);
    const enabled = loadEnv({
      NODE_ENV: "development",
      REDIS_URL: "redis://cache.internal:6379",
    });
    expect(enabled.redisEnabled).toBe(true);
    expect(enabled.redisUrl).toBe("redis://cache.internal:6379");
  });

  test("can be forced off with REDIS_ENABLED=false even with a URL", () => {
    const config = loadEnv({
      NODE_ENV: "development",
      REDIS_URL: "redis://cache.internal:6379",
      REDIS_ENABLED: "false",
    });
    expect(config.redisEnabled).toBe(false);
  });
});
