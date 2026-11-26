import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/settings-api";
import type { ProviderNode } from "@/lib/connections-api";

export type { ProviderNode };

export type CreateNodeInput = {
  name: string;
  prefix: string;
  baseUrl?: string;
  iconUrl?: string;
  type?: "openai-compatible" | "anthropic-compatible";
  apiType?: "chat" | "responses";
};

export async function listNodes(): Promise<ProviderNode[]> {
  const { data } = await api.get<{ nodes: ProviderNode[] }>(
    "/provider-nodes"
  );
  return data.nodes ?? [];
}

export async function createNode(body: CreateNodeInput): Promise<ProviderNode> {
  const { data } = await api.post<{ node: ProviderNode }>(
    "/provider-nodes",
    body
  );
  return data.node;
}

export async function updateNode(
  id: string,
  body: Partial<CreateNodeInput>
): Promise<ProviderNode> {
  const { data } = await api.put<{ node: ProviderNode }>(
    `/provider-nodes/${id}`,
    body
  );
  return data.node;
}

export async function deleteNode(id: string): Promise<void> {
  await api.delete(`/provider-nodes/${id}`);
}

export type ProxyPool = {
  id: string;
  name?: string;
  proxyUrl?: string;
  noProxy?: string;
  type?: string;
  isActive?: boolean;
  testStatus?: string | null;
  strictProxy?: boolean;

  boundConnectionCount?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type CreatePoolInput = {
  name: string;
  proxyUrl: string;
  noProxy?: string;
  type?: string;
  strictProxy?: boolean;
};

export async function listProxyPools(): Promise<ProxyPool[]> {
  const { data } = await api.get<{ proxyPools: ProxyPool[] }>("/proxy-pools", {
    params: { includeUsage: "true" },
  });
  return data.proxyPools ?? [];
}

export async function createProxyPool(
  body: CreatePoolInput
): Promise<ProxyPool> {
  const { data } = await api.post<{ proxyPool?: ProxyPool; pool?: ProxyPool }>("/proxy-pools", body);
  return data.proxyPool ?? data.pool!;
}

export async function updateProxyPool(
  id: string,
  body: Partial<ProxyPool>
): Promise<ProxyPool> {
  const { data } = await api.put<{ proxyPool?: ProxyPool; pool?: ProxyPool }>(
    `/proxy-pools/${id}`,
    body
  );
  return data.proxyPool ?? data.pool!;
}

export type DeployRelayInput =
  | { type: "vercel"; vercelToken: string; projectName?: string }
  | { type: "cloudflare"; accountId: string; apiToken: string; projectName?: string };

export async function deployProxyRelay(body: DeployRelayInput): Promise<{
  proxyPool: ProxyPool;
  deployUrl: string;
}> {
  const path = `/proxy-pools/${body.type}-deploy`;
  const { data } = await api.post<{ proxyPool: ProxyPool; deployUrl: string }>(path, body);
  return data;
}

export async function deleteProxyPool(id: string): Promise<void> {
  await api.delete(`/proxy-pools/${id}`);
}

export async function testProxyPool(id: string): Promise<{
  ok?: boolean;
  status?: number;
  statusText?: string | null;
  error?: string | null;
  elapsedMs?: number;
  testedAt?: string;
  ip?: string;
}> {
  const { data } = await api.post<{
    ok?: boolean;
    status?: number;
    statusText?: string | null;
    error?: string | null;
    elapsedMs?: number;
    testedAt?: string;
    ip?: string;
  }>(`/proxy-pools/${id}/test`);
  return data;
}

export type SettingsForm = {
  profileName: string;
  profileAvatar: string;
  currency: "USD" | "IDR";
  requireApiKey: boolean;
  requireLogin: boolean;
  payloadCaptureEnabled: boolean;
  rtkEnabled: boolean;
  cavemanEnabled: boolean;
  cavemanLevel: string;
  ponytailEnabled: boolean;
  ponytailLevel: string;
  upstreamTimeoutSeconds: string;
  upstreamMaxAttempts: string;
  upstreamStreamTimeoutSeconds: string;
};

const UPSTREAM_TIMEOUT_SECONDS_MIN = 1;
const UPSTREAM_TIMEOUT_SECONDS_MAX = 600;
const UPSTREAM_MAX_ATTEMPTS_MIN = 1;
const UPSTREAM_MAX_ATTEMPTS_MAX = 100;
const UPSTREAM_STREAM_TIMEOUT_SECONDS_MIN = 1;
const UPSTREAM_STREAM_TIMEOUT_SECONDS_MAX = 3600;

function toOptionalInt(raw: string, min: number, max: number): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function toInputValue(value: unknown, divisor = 1): string {
  if (value === null || value === undefined) return "";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n / divisor));
}

export function settingsToForm(s: AppSettings): SettingsForm {
  return {
    profileName: s.profileName?.trim() || "Suwok Router",
    profileAvatar: s.profileAvatar || "",
    currency: s.currency === "IDR" ? "IDR" : "USD",
    requireApiKey: !!s.requireApiKey,
    requireLogin: !!s.requireLogin,
    payloadCaptureEnabled: s.payloadCaptureEnabled !== false,
    rtkEnabled: s.rtkEnabled !== false,
    cavemanEnabled: !!s.cavemanEnabled,
    cavemanLevel: String(s.cavemanLevel || "full"),
    ponytailEnabled: !!s.ponytailEnabled,
    ponytailLevel: String(s.ponytailLevel || "full"),
    upstreamTimeoutSeconds: toInputValue(s.upstreamTimeoutMs, 1000),
    upstreamMaxAttempts: toInputValue(s.upstreamMaxAttempts),
    upstreamStreamTimeoutSeconds: toInputValue(s.upstreamStreamTimeoutMs, 1000),
  };
}

export function formToSettingsPartial(
  f: SettingsForm
): Partial<AppSettings> {
  const timeoutSeconds = toOptionalInt(
    f.upstreamTimeoutSeconds,
    UPSTREAM_TIMEOUT_SECONDS_MIN,
    UPSTREAM_TIMEOUT_SECONDS_MAX,
  );
  const streamTimeoutSeconds = toOptionalInt(
    f.upstreamStreamTimeoutSeconds,
    UPSTREAM_STREAM_TIMEOUT_SECONDS_MIN,
    UPSTREAM_STREAM_TIMEOUT_SECONDS_MAX,
  );
  return {
    requireApiKey: f.requireApiKey,
    requireLogin: f.requireLogin,
    payloadCaptureEnabled: f.payloadCaptureEnabled,
    rtkEnabled: f.rtkEnabled,
    cavemanEnabled: f.cavemanEnabled,
    cavemanLevel: f.cavemanLevel,
    ponytailEnabled: f.ponytailEnabled,
    ponytailLevel: f.ponytailLevel,
    upstreamTimeoutMs: timeoutSeconds === null ? null : timeoutSeconds * 1000,
    upstreamMaxAttempts: toOptionalInt(
      f.upstreamMaxAttempts,
      UPSTREAM_MAX_ATTEMPTS_MIN,
      UPSTREAM_MAX_ATTEMPTS_MAX,
    ),
    upstreamStreamTimeoutMs: streamTimeoutSeconds === null ? null : streamTimeoutSeconds * 1000,
  };
}

export type Combo = {
  id?: string;
  name: string;
  models: string[];
  disabledModels?: string[];
  group?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export type ComboStrategy = "fallback" | "round-robin" | "fusion" | "latency";

export type ComboStrategyConfig = {
  fallbackStrategy?: ComboStrategy;
  judgeModel?: string;
  fusionTuning?: string;
  /** 0 = unlimited: every account of a model may be tried before falling through. */
  maxAccountAttempts?: number;
};

export async function listCombos(): Promise<Combo[]> {
  const { data } = await api.get<{ combos: Combo[] }>("/combos");
  return data.combos ?? [];
}

export async function createCombo(body: {
  name: string;
  models: string[];
  group?: string | null;
  disabledModels?: string[];
}): Promise<Combo> {

  const { data } = await api.post<Combo>("/combos", body);
  return data;
}

export async function updateCombo(
  id: string,
  body: { models?: string[]; name?: string; group?: string | null; disabledModels?: string[] }
): Promise<Combo> {

  const { data } = await api.put<Combo>(`/combos/${encodeURIComponent(id)}`, body);
  return data;
}

export async function deleteCombo(id: string): Promise<void> {
  await api.delete(`/combos/${encodeURIComponent(id)}`);
}
