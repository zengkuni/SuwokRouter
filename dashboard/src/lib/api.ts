import axios, { type AxiosError } from "axios";
import { useAuthStore } from "@/stores/authStore";
import type { Connection } from "@/lib/connections-api";

export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

api.interceptors.request.use((config) => {

  void useAuthStore.getState();
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error: AxiosError<{ error?: { message?: string; type?: string; code?: string } }>) => {
    if (error.response?.status === 401) {

      const code = error.response.data?.error?.code;
      if (code === "dashboard_auth_required" || !code) {
        useAuthStore.getState().clearAuth();
        if (
          typeof window !== "undefined" &&
          !window.location.pathname.startsWith("/login")
        ) {
          window.location.assign("/login");
        }
      }
    }
    return Promise.reject(error);
  }
);

export function getErrorMessage(err: unknown, fallback = "Request failed") {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string } | string; message?: string }
      | undefined;
    if (typeof data?.error === "string") return data.error;
    return data?.error?.message || data?.message || err.message || fallback;
  }
  if (err instanceof Error) return err.message;
  return fallback;
}

export function beautifyPath(p: string | undefined | null): string {
  if (!p) return "";

  const windowsHome = /^[A-Za-z]:[\\/]+Users[\\/]+[^\\/]+/i;
  const posixHome = /^\/(?:home|Users)\/[^/]+/;
  return p.replace(windowsHome, "~").replace(posixHome, "~");
}

export function compactDatabasePath(p: string | undefined | null): string {
  const masked = beautifyPath(p);
  if (!masked) return "";
  const normalized = masked.replaceAll("\\", "/");
  const withoutDbDirectory = normalized.replace(/\/db\/data\.sqlite$/i, "/data.sqlite");
  if (/^~\/(?:AppData\/Roaming\/)?\.swayrouter\/data\.sqlite$/i.test(withoutDbDirectory)) {
    return "~/.swayrouter/data.sqlite";
  }
  return withoutDbDirectory;
}

export type AuthStatus = {
  requireLogin: boolean;
  authMode: "password" | "oidc";
  oidcConfigured: boolean;
  oidcLoginLabel: string;
  hasPassword: boolean;
  defaultPasswordActive: boolean;
  displayName: string;
  loginMethod: "Password" | "OIDC";
  authenticated: boolean;
  oidcName: string | null;
  oidcEmail: string | null;
  oidcLogin: boolean;
};

export async function fetchAuthStatus() {
  const { data } = await api.get<AuthStatus>("/auth/status");
  return data;
}

export async function login(password: string) {
  const { data } = await api.post<{
    success?: boolean;
    mustChangePassword?: boolean;
    message?: string;
  }>("/auth/login", { password });
  return data;
}

export async function logout() {
  await api.post("/auth/logout");
}

export async function verifyDashboardPassword(password: string) {
  const { data } = await api.post<{ verified?: boolean }>(
    "/auth/verify-password",
    { password },
  );
  return data.verified === true;
}

export type UsageBucket = {
  requests?: number;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;

  cachedTokens?: number;

  cacheCreationTokens?: number;
};

export type UsageModelRow = UsageBucket & {
  model: string;
  provider?: string;
};

export type UsageRange = "today" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y" | "all";

export type UsageDailyPoint = {
  date: string;

  key?: string;
  requests: number;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost: number;
  errors: number;
};

export type UsageStats = {
  total: number;
  totalCost: number;
  totalPromptTokens?: number;
  totalCompletionTokens?: number;
  totalCachedTokens?: number;
  byProvider: Record<string, UsageBucket>;
  byModel?: UsageModelRow[];
  daily?: UsageDailyPoint[];
  since?: string;

  recentRequests?: UsageRow[];
  byApiKey?: Record<string, UsageBucket & { lastUsed?: string }>;
};

export type UsageChartBucket = {
  date?: string;
  label: string;
  tokens: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cost: number;
  requests?: number;
  errors?: number;
};

export type UsageHeatmapPoint = UsageDailyPoint;

export type ChartPeriod = "today" | "24h" | "7d" | "30d" | "60d" | "90d" | "180d" | "365d" | "year" | "all";

export async function fetchChartData(params?: { period?: ChartPeriod }) {

  const { data } = await api.get<UsageChartBucket[]>("/usage/chart", {
    params: { period: params?.period || "7d" },
  });
  return Array.isArray(data) ? data : [];
}

export async function fetchUsageHeatmap(periodOrDays: ChartPeriod | number = 90) {
  const period = typeof periodOrDays === "number"
    ? periodOrDays <= 7 ? "7d" : periodOrDays <= 30 ? "30d" : periodOrDays <= 90 ? "90d" : periodOrDays <= 180 ? "180d" : "365d"
    : periodOrDays;
  const { data } = await api.get<UsageChartBucket[]>("/usage/chart", {
    params: { period },
  });
  const points = Array.isArray(data)
    ? data.map((bucket) => ({
        date: bucket.date || bucket.label,
        key: bucket.date || bucket.label,
        requests: Number(bucket.requests) || 0,
        tokens: Number(bucket.tokens) || 0,
        promptTokens: Number(bucket.promptTokens) || 0,
        completionTokens: Number(bucket.completionTokens) || 0,
        cachedTokens: Number(bucket.cachedTokens) || 0,
        cost: Number(bucket.cost) || 0,
        errors: Number(bucket.errors) || 0,
      }))
    : [];

  if (period === "today") {
    const now = new Date();
    const date = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    return [
      points.reduce(
        (total, point) => ({
          date,
          key: date,
          requests: total.requests + point.requests,
          tokens: total.tokens + point.tokens,
          promptTokens: total.promptTokens + (point.promptTokens || 0),
          completionTokens: total.completionTokens + (point.completionTokens || 0),
          cachedTokens: total.cachedTokens + (point.cachedTokens || 0),
          cost: total.cost + point.cost,
          errors: total.errors + point.errors,
        }),
        {
          date,
          key: date,
          requests: 0,
          tokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          cachedTokens: 0,
          cost: 0,
          errors: 0,
        },
      ),
    ];
  }

  return points;
}

export async function fetchUsageStats(params?: { range?: UsageRange }) {

  const period =
    params?.range === "14d"
      ? "30d"
      : params?.range === "1y"
        ? "365d"
        : params?.range || "7d";
  const { data } = await api.get<
    UsageStats & {
      totalRequests?: number;
      last10Minutes?: Array<{
        label?: string;
        requests?: number;
        promptTokens?: number;
        completionTokens?: number;
        cost?: number;
      }>;
      byModel?: Record<
        string,
        UsageModelRow & { rawModel?: string; lastUsed?: string }
      >;
    }
  >("/usage/stats", {
    params: {

      period,
    },
  });

  const byModelMap = (data.byModel as
    | Record<string, UsageModelRow & { rawModel?: string }>
    | undefined) ?? {};
  const byModel = Array.isArray(data.byModel)
    ? (data.byModel as UsageModelRow[])
    : Object.entries(byModelMap).map(([key, row]) => ({
        model: row.rawModel || key.split(" (")[0],
        provider: row.provider || "",
        requests: row.requests ?? 0,
        cost: row.cost ?? 0,
        promptTokens: row.promptTokens ?? 0,
        completionTokens: row.completionTokens ?? 0,
        cachedTokens: row.cachedTokens ?? 0,
        cacheCreationTokens: row.cacheCreationTokens ?? 0,
      }));
  const last10 = Array.isArray(data.last10Minutes) ? data.last10Minutes : [];

  const sumByProvider = (key: "promptTokens" | "completionTokens" | "cachedTokens") =>
    Object.values(data.byProvider ?? {}).reduce(
      (s, p) => s + (p?.[key] ?? 0),
      0
    );
  return {
    total: data.total ?? data.totalRequests ?? 0,
    totalCost: data.totalCost ?? 0,
    totalPromptTokens: data.totalPromptTokens ?? sumByProvider("promptTokens"),
    totalCompletionTokens:
      data.totalCompletionTokens ?? sumByProvider("completionTokens"),
    totalCachedTokens:
      data.totalCachedTokens ?? sumByProvider("cachedTokens"),
    byProvider: data.byProvider ?? {},
    byModel,
    since: data.since,
    byApiKey: data.byApiKey ?? {},

    recentRequests: data.recentRequests ?? [],

    daily: last10.map((b, i) => ({
      date: b.label || `-${9 - i}m`,
      requests: b.requests ?? 0,
      tokens: (b.promptTokens ?? 0) + (b.completionTokens ?? 0),
      cost: b.cost ?? 0,
      errors: 0,
    })),
  };
}

export type UsageRow = {
  id?: number | string;
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKeyId?: string;
  endpoint?: string;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;

  cachedTokens?: number;

  cacheCreationTokens?: number;
  status?: string;
  latencyMs?: number;
  error?: string | null;
};

export async function fetchUsageHistory(params?: {
  limit?: number;
  provider?: string;
  apiKeyId?: string;
  range?: UsageRange;

  startDate?: string;
}) {

  const { data } = await api.get<{ usage?: UsageRow[] }>(
    "/usage/history",
    {
      params: {
        limit: params?.limit ?? 50,
        provider: params?.provider,
        apiKeyId: params?.apiKeyId,
        range: params?.range || undefined,
        startDate: params?.startDate,
      },
    }
  );
  return data.usage ?? [];
}

export type RequestDetailTokenUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  [key: string]: unknown;
};

export type RequestDetailLatency = {
  total?: number;

  throughput?: number;
  ttft?: number;
  [key: string]: unknown;
};

export type RequestDetailData = {
  id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  endpoint?: string;
  cost?: number;
  promptTokens?: number;
  completionTokens?: number;
  cachedTokens?: number;
  cacheCreationTokens?: number;
  status?: string;
  latency?: RequestDetailLatency;
  tokens?: RequestDetailTokenUsage;
  error?: string | null;

  request?: { url?: string; method?: string; headers?: Record<string, unknown>; body?: unknown } | null;
  providerRequest?: unknown;
  providerResponse?: unknown;
  response?: unknown;
  [key: string]: unknown;
};

export type RequestDetailsResult = {
  details: RequestDetailData[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};

export type UsageClearRange = "today" | "24h" | "7d" | "14d" | "30d" | "60d" | "90d" | "1y" | "all";

export async function clearUsageHistory(range: UsageClearRange = "all") {
  const { data } = await api.delete<{ ok: boolean; range: UsageClearRange; deleted: { usageHistory: number; usageDaily: number; requestDetails: number } }>("/usage/history", {
    params: { range },
  });
  return data;
}

export async function fetchRequestDetails(params?: {
  page?: number;
  pageSize?: number;
  provider?: string;
  model?: string;
  connectionId?: string;
  status?: string;
  query?: string;
  sortDir?: "asc" | "desc";
  startDate?: string;
  endDate?: string;
  source?: "usage";
  includePayloads?: boolean;
}): Promise<RequestDetailsResult> {
  const { data } = await api.get<RequestDetailsResult>("/usage/request-details", {
    params: {
      page: params?.page ?? 1,
      pageSize: params?.pageSize ?? 20,
      provider: params?.provider,
      model: params?.model,
      connectionId: params?.connectionId,
      status: params?.status,
      q: params?.query,
      sortDir: params?.sortDir,
      startDate: params?.startDate,
      endDate: params?.endDate,
      source: params?.source,
      payloads: params?.includePayloads ? "true" : undefined,
    },
  });
  return data;
}

export async function fetchUsageByApiKey(apiKeyId: string) {

  const stats = await fetchUsageStats();
  const row = (stats.byApiKey as Record<string, Record<string, unknown>> | undefined)?.[
    apiKeyId
  ] ?? {};
  return {
    key: { id: apiKeyId },
    usage: {
      requests: (row.requests as number) || 0,
      promptTokens: (row.promptTokens as number) || 0,
      completionTokens: (row.completionTokens as number) || 0,
      totalTokens:
        ((row.promptTokens as number) || 0) +
        ((row.completionTokens as number) || 0),
      totalCostUsd: (row.cost as number) || 0,
      tokensUsedPeriod:
        ((row.promptTokens as number) || 0) +
        ((row.completionTokens as number) || 0),
      costUsedPeriodUsd: (row.cost as number) || 0,
      periodStart: (row.lastUsed as string) || undefined,
    },
  };
}

export async function fetchConnections(params?: {
  provider?: string;
  active?: boolean;

  limit?: number;
}) {
  const { data } = await api.get<{ connections: Connection[] }>("/providers", {
    params,
  });
  return data.connections ?? [];
}

export async function fetchAvailableProviders() {
  const { data } = await api.get<{ providers: unknown[] }>(
    "/providers/client"
  );
  return data.providers ?? [];
}

export type UsageQuota = {
  used: number;
  total: number;

  remaining?: number;
  remainingPercentage?: number;
  resetAt?: string | null;
  unlimited?: boolean;
  recurring?: boolean;
  displayName?: string;
  modelKey?: string;
  unit?: string;
  [key: string]: unknown;
};

export type ProviderUsage = {
  plan?: string | null;
  message?: string | null;
  quotas?: Record<string, UsageQuota>;
  resetCredits?: { availableCount?: number };
  limitReached?: boolean;
  reviewLimitReached?: boolean;
  [key: string]: unknown;
};

export async function fetchUsageForConnection(connectionId: string, signal?: AbortSignal) {
  const { data } = await api.get<ProviderUsage>(
    `/usage/${encodeURIComponent(connectionId)}`,
    {
      signal,
      timeout: 15_000,
    },
  );
  return data;
}

export async function fetchCodexResetCredits(connectionId: string) {
  const { data } = await api.get<{
    availableCount?: number;
    credits?: Array<{ status?: string; grantedAt?: string | null; expiresAt?: string | null }>;
  }>(`/usage/${encodeURIComponent(connectionId)}/codex-reset-credits`);
  return data;
}

export async function resetCodexCredits(connectionId: string) {
  const { data } = await api.post<{
    code?: string;
    reset?: boolean;
    windows_reset?: number;
    redeemRequestId?: string;
    credit?: unknown;
    message?: string;
  }>(`/usage/${encodeURIComponent(connectionId)}/codex-reset-credits`);
  return data;
}
