import { api } from "@/lib/api";
import type { AppSettings } from "@/lib/settings-api";
import type { ProviderNode } from "@/lib/connections-api";

export type { ProviderNode };

export type CreateNodeInput = {
  name: string;
  prefix: string;
  baseUrl?: string;
  type?: "openai-compatible" | "anthropic-compatible";
  apiType?: "chat" | "responses";
};

export async function listNodes(): Promise<ProviderNode[]> {
  const { data } = await api.get<{ nodes: ProviderNode[] }>(
    "/provider-nodes"
  );
  return data.nodes ?? [];
}

export async function getNode(id: string): Promise<ProviderNode | null> {
  const { data } = await api.get<{ node: ProviderNode }>(
    `/provider-nodes/${id}`
  );
  return data.node ?? null;
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

export type RequestDetail = {
  id: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKeyId?: string;
  status?: string;
  data?: unknown;
};

export type RequestDetailListResult = {
  details: RequestDetail[];
  pagination?: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
};

export async function listUsageDetails(limit = 50): Promise<RequestDetail[]> {

  const pageSize = Math.min(limit, 100);
  const { data } = await api.get<RequestDetailListResult>(
    "/usage/request-details",
    { params: { page: 1, pageSize } }
  );
  return data.details ?? [];
}

export async function getUsageDetail(id: string): Promise<RequestDetail | null> {

  const { data } = await api.get<RequestDetailListResult>(
    "/usage/request-details",
    { params: { page: 1, pageSize: 100 } }
  );
  return (data.details ?? []).find((d) => d.id === id) ?? null;
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
};

export function settingsToForm(s: AppSettings): SettingsForm {
  return {
    profileName: s.profileName?.trim() || "Sway Router",
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
  };
}

export function formToSettingsPartial(
  f: SettingsForm
): Partial<AppSettings> {
  return {
    requireApiKey: f.requireApiKey,
    requireLogin: f.requireLogin,
    payloadCaptureEnabled: f.payloadCaptureEnabled,
    rtkEnabled: f.rtkEnabled,
    cavemanEnabled: f.cavemanEnabled,
    cavemanLevel: f.cavemanLevel,
    ponytailEnabled: f.ponytailEnabled,
    ponytailLevel: f.ponytailLevel,
  };
}

export type Combo = {
  id?: string;
  name: string;
  models: string[];
  createdAt?: string;
  updatedAt?: string;
};

export type ComboStrategy = "fallback" | "round-robin" | "fusion";

export type ComboStrategyConfig = {
  fallbackStrategy?: ComboStrategy;
  judgeModel?: string;
  fusionTuning?: string;
};

export async function listCombos(): Promise<Combo[]> {
  const { data } = await api.get<{ combos: Combo[] }>("/combos");
  return data.combos ?? [];
}

export async function createCombo(body: {
  name: string;
  models: string[];
}): Promise<Combo> {

  const { data } = await api.post<Combo>("/combos", body);
  return data;
}

export async function updateCombo(
  id: string,
  body: { models?: string[]; name?: string }
): Promise<Combo> {

  const { data } = await api.put<Combo>(`/combos/${encodeURIComponent(id)}`, body);
  return data;
}

export async function deleteCombo(id: string): Promise<void> {
  await api.delete(`/combos/${encodeURIComponent(id)}`);
}
