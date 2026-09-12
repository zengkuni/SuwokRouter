import { deriveResourceProfile } from "./resourceProfile";
import { installRuntimeSecrets } from "./runtimeSecrets";

export type NodeEnv = "development" | "production" | "test";

export interface EnvConfig {
  port: number;
  hostname: string;
  dataDir: string;
  baseUrl: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  apiKeySecret: string;

  initialPassword: string;
  nodeEnv: NodeEnv;
  trustProxy: boolean;
  requestLogsEnabled: boolean;
  requestLogsConfigured: boolean;
  translatorEnabled: boolean;
  authCookieSecure: boolean;
  metricsToken: string;
  metricsLocal: boolean;
  resourceProfile: "low-memory" | "balanced" | "throughput";
  resourceMemoryBytes: number;
  resourceCpuCount: number;

  routerMaxConcurrent: number;
  routerInitialConcurrent: number;
  routerMinConcurrent: number;
  routerMaxQueue: number;
  routerQueueWaitMs: number;
  routerBodyBudgetBytes: number;
  routerBodyReadTimeoutMs: number;
  routerMemoryHighWaterBytes: number;
  routerMemoryCriticalWaterBytes: number;

  usageHistoryRetentionDays: number;
  usageHistoryMaxRows: number;

  upstreamMaxAttempts: number;
}

const DEFAULT_PASSWORD = "123456";
const INSECURE_JWT_SECRETS = new Set(["", "change-me", "secret", "development-secret"]);
const INSECURE_API_KEY_SECRETS = new Set(["", "endpoint-proxy-api-key-secret", "change-me"]);

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  return port;
}

function parseHostname(value: string | undefined): string {
  const hostname = String(value ?? "").trim() || "127.0.0.1";
  if (/\s/.test(hostname) || hostname.length > 255) {
    throw new Error("HOSTNAME must be a valid listen host");
  }
  return hostname;
}

function parseBoolean(value: string): boolean {
  return value === "true" || value === "1";
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function parseNodeEnv(value: string): NodeEnv {
  if (value === "development" || value === "production" || value === "test") return value;
  throw new Error("NODE_ENV must be development, test, or production");
}

export function loadEnv(source: Record<string, string | undefined> = process.env): EnvConfig {
  const nodeEnv = parseNodeEnv(source.NODE_ENV ?? "development");
  const jwtSecret = source.JWT_SECRET ?? (nodeEnv === "production" ? "" : "change-me");
  const apiKeySecret = source.API_KEY_SECRET ?? (nodeEnv === "production" ? "" : "endpoint-proxy-api-key-secret");

  const initialPassword = DEFAULT_PASSWORD;

  if (nodeEnv === "production") {
    if (INSECURE_JWT_SECRETS.has(jwtSecret) || jwtSecret.length < 32) {
      throw new Error("JWT_SECRET must be explicitly configured with at least 32 characters in production");
    }
    if (INSECURE_API_KEY_SECRETS.has(apiKeySecret) || apiKeySecret.length < 32) {
      throw new Error("API_KEY_SECRET must be explicitly configured with at least 32 characters in production");
    }
  }

  const dataDir = source.DATA_DIR?.trim() || "";
  const baseUrl = source.BASE_URL?.trim() || source.NEXT_PUBLIC_BASE_URL?.trim() || "";
  const metricsToken = source.SWAY_METRICS_TOKEN?.trim() || "";
  const resource = deriveResourceProfile(undefined, source.SWAY_PERFORMANCE_PROFILE);
  const routerMaxConcurrent = parsePositiveInt(source.SWAY_ROUTER_MAX_CONCURRENT, resource.maxConcurrent, 100_000);
  const routerInitialConcurrent = Math.min(
    routerMaxConcurrent,
    parsePositiveInt(source.SWAY_ROUTER_INITIAL_CONCURRENT, resource.initialConcurrent, 100_000),
  );
  const routerMinConcurrent = Math.min(
    routerInitialConcurrent,
    parsePositiveInt(source.SWAY_ROUTER_MIN_CONCURRENT, resource.minConcurrent, 100_000),
  );
  const routerBodyBudgetBytes = parsePositiveInt(
    source.SWAY_ROUTER_BODY_BUDGET_MB,
    resource.bodyBudgetMb,
    16 * 1024,
  ) * 1024 * 1024;
  const routerMemoryHighWaterBytes = parsePositiveInt(
    source.SWAY_ROUTER_MEMORY_HIGH_WATER_MB,
    0,
    1024 * 1024,
  ) * 1024 * 1024;
  const routerMemoryCriticalWaterBytes = parsePositiveInt(
    source.SWAY_ROUTER_MEMORY_CRITICAL_MB,
    0,
    1024 * 1024,
  ) * 1024 * 1024;

  return Object.freeze({
    port: parsePort(source.PORT ?? "14045"),
    hostname: parseHostname(source.HOSTNAME),
    dataDir,
    baseUrl,
    jwtSecret,
    jwtExpiresIn: source.JWT_EXPIRES_IN ?? "7d",
    apiKeySecret,
    initialPassword,
    nodeEnv,
    trustProxy: parseBoolean(source.TRUST_PROXY ?? "false"),
    requestLogsEnabled: parseBoolean(source.ENABLE_REQUEST_LOGS ?? "false"),
    requestLogsConfigured: source.ENABLE_REQUEST_LOGS !== undefined,
    translatorEnabled: parseBoolean(source.ENABLE_TRANSLATOR ?? "false"),
    authCookieSecure: parseBoolean(source.AUTH_COOKIE_SECURE ?? "false"),
    metricsToken,
    metricsLocal: source.SWAY_METRICS_LOCAL !== "0",
    resourceProfile: resource.name,
    resourceMemoryBytes: resource.memoryBytes,
    resourceCpuCount: resource.cpuCount,
    routerMaxConcurrent,
    routerInitialConcurrent,
    routerMinConcurrent,
    routerMaxQueue: parsePositiveInt(source.SWAY_ROUTER_MAX_QUEUE, resource.maxQueue, 1_000_000),
    routerQueueWaitMs: parsePositiveInt(
      source.SWAY_ROUTER_QUEUE_WAIT_MS,
      resource.queueWaitMs,
      10 * 60 * 1000,
    ),
    routerBodyBudgetBytes,
    routerBodyReadTimeoutMs: parsePositiveInt(source.SWAY_ROUTER_BODY_TIMEOUT_MS, 30_000, 10 * 60 * 1000),
    routerMemoryHighWaterBytes,
    routerMemoryCriticalWaterBytes,
    usageHistoryRetentionDays: parsePositiveInt(source.SWAY_USAGE_RETENTION_DAYS, 7, 3650),
    usageHistoryMaxRows: parsePositiveInt(source.SWAY_USAGE_HISTORY_MAX_ROWS, 500_000, 100_000_000),
    upstreamMaxAttempts: parsePositiveInt(
      source.SWAY_UPSTREAM_MAX_ATTEMPTS,
      nodeEnv === "production" ? resource.upstreamMaxAttempts : 8,
      100,
    ),
  });
}

if (process.env.NODE_ENV !== "test") installRuntimeSecrets(process.env);

export const env = loadEnv();

export function getEnvConfig(options: { refresh?: boolean } = {}): EnvConfig {
  if (!options.refresh) return env;
  if (process.env.NODE_ENV !== "test") installRuntimeSecrets(process.env);
  return loadEnv(process.env);
}
