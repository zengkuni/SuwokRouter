import { api } from "@/lib/api";
import { getBuiltinProviders, getProviderDisplay } from "@/lib/providers";

export type Connection = {
  id: string;
  provider: string;
  name?: string | null;
  email?: string | null;
  authType?: string;
  isActive?: boolean;
  priority?: number;

  proxyPoolId?: string | null;
  providerSpecificData?: Record<string, unknown> | null;

  keyHint?: string | null;
  testStatus?: string;
  lastTested?: string | null;
  lastError?: string | null;
  errorCode?: number | string | null;
  healthStatus?: string;
  healthError?: string | null;
  healthLatencyMs?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

export type AvailableProvider = {
  id: string;
  alias?: string;
  name: string;
  color?: string;
  icon?: string;
  textIcon?: string;
  category?: string;
  authType?: string;
  connected?: number;
  noAuth?: boolean;
  hasOAuth?: boolean;
  isCustom?: boolean;

  passthroughModels?: boolean;
  baseUrl?: string;
  nodeType?: string;
  apiType?: string;

  authModes?: string[];
  models?: Array<{
    id: string;
    name?: string;
    capabilities?: Record<string, unknown>;
    thinkingLevels?: string[];
  }>;
  thinkingConfig?: {
    options?: string[];
    defaultMode?: string;
    modelAware?: boolean;
  };
};

export function usesConnectionModelCatalog(
  provider: Pick<AvailableProvider, "isCustom" | "nodeType" | "passthroughModels"> | null | undefined,
): boolean {
  return Boolean(provider?.isCustom || provider?.nodeType || provider?.passthroughModels);
}

export async function getConnectionModels(connectionId: string, refresh = false) {
  const { data } = await api.get<{ provider?: string; connectionId?: string; models?: unknown[]; warning?: string; cached?: boolean }>(
    `/providers/${encodeURIComponent(connectionId)}/models`,
    refresh ? { params: { refresh: "1" } } : undefined,
  );
  return data;
}

export async function listConnections(params?: {
  provider?: string;
  active?: boolean | string;
}) {
  const { data } = await api.get<{ connections: Connection[] }>(
    "/providers",
    { params }
  );
  return data.connections ?? [];
}

export type PaginationMeta = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export async function listConnectionsPage(params: {
  provider?: string;
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<{ connections: Connection[]; pagination: PaginationMeta }> {
  const { data } = await api.get<{
    connections: Connection[] | undefined;
    pagination: PaginationMeta;
  }>("/providers", { params });

  return {
    connections: data.connections ?? [],
    pagination: data.pagination ?? {
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 50,
      totalItems: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
  };
}

export type ProviderCount = {
  provider: string;
  total: number;
  active: number;
  inactive: number;
};

export async function listProviderCounts(): Promise<ProviderCount[]> {
  const { data } = await api.get<{ counts: ProviderCount[] }>(
    "/providers/counts"
  );
  return data.counts ?? [];
}

export async function getProviderCatalog(): Promise<AvailableProvider[]> {
  try {
    const { data } = await api.get<{ providers?: AvailableProvider[] }>(
      "/providers/catalog"
    );
    const list = data.providers ?? [];
    if (list.length) return list;
  } catch {

  }
  return [];
}

export async function listAvailableProviders(): Promise<AvailableProvider[]> {
  const [catalog, counts, nodesRes] = await Promise.all([
    getProviderCatalog(),
    listProviderCounts(),
    api.get<{ nodes: ProviderNode[] }>("/provider-nodes"),
  ]);
  const catalogList = catalog.length
    ? catalog
    : getBuiltinProviders();
  const nodes = nodesRes.data.nodes ?? [];

  const providerKey = (value: unknown) =>
    String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const countMap = new Map<string, ProviderCount>();
  for (const row of counts) {
    const value = String(row.provider).trim().toLowerCase();
    countMap.set(value, row);
    countMap.set(providerKey(value), row);
  }

  for (const provider of catalogList) {
    const candidates = [provider.id, provider.alias].filter(Boolean).flatMap((value) => {
      const normalized = String(value).trim().toLowerCase();
      return [normalized, providerKey(normalized)];
    });
    const count = candidates.map((key) => countMap.get(key)).find(Boolean);
    if (count) {
      for (const key of candidates) countMap.set(key, count);
    }
  }
  for (const node of nodes) {
    const candidates = [node.id, node.prefix].filter(Boolean).flatMap((value) => {
      const normalized = String(value).trim().toLowerCase();
      return [normalized, providerKey(normalized)];
    });
    const count = candidates.map((key) => countMap.get(key)).find(Boolean);
    if (count) {
      for (const key of candidates) countMap.set(key, count);
    }
  }

  const connectedProviders = Array.from(new Set(
    counts.map((row) => String(row.provider).trim())
  ));
  const connectedKeys = new Set<string>();
  const canonicalConnectedProviders = connectedProviders.filter((providerId) => {
    const key = providerKey(providerId);
    if (connectedKeys.has(key)) return false;
    connectedKeys.add(key);
    return true;
  });
  connectedProviders.splice(0, connectedProviders.length, ...canonicalConnectedProviders);

  const seen = new Set<string>();
  const out: AvailableProvider[] = [];

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const findCatalogProvider = (providerId: string) => {
    const normalized = providerId.trim().toLowerCase();
    const compact = providerKey(normalized);
    return catalogList.find((provider) =>
      [provider.id, provider.alias].some((value) => {
        const candidate = String(value || "").trim().toLowerCase();
        return candidate === normalized || providerKey(candidate) === compact;
      })
    );
  };
  const findCount = (providerId: string): ProviderCount | undefined => {
    const normalized = providerId.trim().toLowerCase();
    return (
      countMap.get(normalized) ||
      countMap.get(providerKey(normalized)) ||
      (() => {
        const catalogProvider = findCatalogProvider(providerId);
        if (!catalogProvider) return undefined;
        return (
          countMap.get(String(catalogProvider.id).trim().toLowerCase()) ||
          countMap.get(providerKey(catalogProvider.id)) ||
          (catalogProvider.alias
            ? countMap.get(String(catalogProvider.alias).trim().toLowerCase()) ||
              countMap.get(providerKey(catalogProvider.alias))
            : undefined)
        );
      })()
    );
  };

  for (const provider of catalogList) {
    const count = findCount(provider.id) || (provider.alias ? findCount(provider.alias) : undefined);
    if (!count) continue;
    const canonical = provider.id.trim().toLowerCase();
    countMap.set(canonical, count);
    countMap.set(providerKey(canonical), count);
    if (provider.alias) {
      countMap.set(provider.alias.trim().toLowerCase(), count);
      countMap.set(providerKey(provider.alias), count);
    }
  }

  for (const providerId of connectedProviders) {
    const normalizedProviderId = providerId.trim().toLowerCase();
    const catalogProvider = findCatalogProvider(providerId);
    const canonicalId = catalogProvider?.id || providerId;
    const display = getProviderDisplay(canonicalId) || catalogProvider;
    const node = nodeById.get(canonicalId) || nodeById.get(providerId);
    const count =
      countMap.get(normalizedProviderId) ||
      countMap.get(providerKey(normalizedProviderId)) ||
      countMap.get(canonicalId.toLowerCase()) ||
      countMap.get(providerKey(canonicalId));
    out.push({
      id: canonicalId,
      alias: node?.prefix || display?.alias,
      name: node?.name || display?.name || canonicalId,
      color: display?.color,
      icon: node ? "sway-custom" : display?.icon,
      textIcon: display?.textIcon,
      category: display?.category,
      authType: display?.authType || "apikey",
      noAuth: display?.noAuth,
      authModes: display?.authModes,
      thinkingConfig: catalogProvider?.thinkingConfig,
      passthroughModels: catalogProvider?.passthroughModels === true,
      isCustom: Boolean(node),
      baseUrl: node?.baseUrl,
      nodeType: node?.type,
      apiType: node?.apiType,
      connected: count?.total ?? 0,
    });
    seen.add(canonicalId);
  }

  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    out.push({
      id: n.id,
      alias: n.prefix || n.id,
      name: n.name || n.prefix || n.id,
      authType: "apikey",
      isCustom: true,
      baseUrl: n.baseUrl,
      nodeType: n.type,
      apiType: n.apiType,
      icon: "sway",
      connected: 0,
    });
    seen.add(n.id);
  }

  for (const b of catalogList) {
    if (seen.has(b.id)) continue;
    out.push({ ...b, connected: 0 });
  }

  return out;
}

export async function createConnection(body: {
  provider: string;
  apiKey?: string;
  credentialToken?: string;
  accessToken?: string;
  refreshToken?: string;
  name?: string;

  autoName?: boolean;
  priority?: number;
  proxyPoolId?: string | null;
}) {
  const { data } = await api.post<{ connection: Connection }>(
    "/providers",
    body
  );
  return data.connection;
}

export async function updateConnection(
  id: string,
  body: Partial<Connection> & {
    name?: string;
    priority?: number;
    isActive?: boolean;
    proxyPoolId?: string | null;
  }
) {
  const { data } = await api.put<{ connection: Connection }>(
    `/providers/${id}`,
    body
  );
  return data.connection;
}

export async function deleteConnection(id: string) {
  const { data } = await api.delete<{ success: boolean; id: string }>(
    `/providers/${id}`
  );
  return data;
}

export async function toggleConnection(
  id: string,
  currentActive: boolean
) {
  const { data } = await api.put<{ connection: Connection }>(
    `/providers/${id}`,
    { isActive: !currentActive }
  );
  return data.connection;
}

export async function testConnection(
  id: string,
  body?: { model?: string; forceChat?: boolean },
  opts?: { signal?: AbortSignal }
) {

  const { data } = await api.post<{
    valid: boolean;
    error?: string | null;
    refreshed?: boolean;
    latencyMs?: number;
    testedAt?: string;
  }>(`/providers/${id}/test`, body || {}, {
    signal: opts?.signal,
  });
  return data;
}

export async function testConnectionModels(
  id: string,
  opts?: { model?: string; signal?: AbortSignal }
) {
  const { data } = await api.post<{
    provider?: string;
    connectionId?: string;
    requestedModel?: string | null;
    results?: Array<{
      modelId?: string;
      name?: string;
      ok?: boolean;
      error?: string | null;
      latencyMs?: number;
      status?: number;
    }>;
    error?: string;
    message?: string;
  }>(`/providers/${id}/test-models`, opts?.model ? { model: opts.model } : {}, {
    signal: opts?.signal,
  });
  return data;
}

export async function testProviderKey(body: {
  provider: string;
  apiKey: string;
  providerSpecificData?: Record<string, unknown>;
}) {
  const { data } = await api.post<{
    valid: boolean;
    error?: string | null;
  }>("/providers/validate", body);
  return data;
}

export async function testCodeBuddyToken(body: {
  provider: string;
  credentialToken?: string;
  accessToken?: string;
  refreshToken?: string;
}) {
  const { data } = await api.post<{
    valid: boolean;
    error?: string | null;
  }>("/providers/validate", body);
  return data;
}

export type ProviderNode = {
  id: string;
  name: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  type?: string;
};

export type OAuthAuthData = {
  authUrl?: string;
  url?: string;
  authorizeUrl?: string;
  state?: string;
  codeVerifier?: string;
  codeChallenge?: string;
  redirectUri?: string;
  flowType?: string;
  fixedPort?: number;
  callbackPath?: string;
  [key: string]: unknown;
};

export type OAuthProxyStart = {
  success?: boolean;
  serverSide?: boolean;
  reason?: string;
  [key: string]: unknown;
};

export type OAuthSessionStatus = {
  status?: "pending" | "processing" | "done" | "error" | "unknown" | string;
  connectionId?: string;
  email?: string | null;
  error?: string | null;
  [key: string]: unknown;
};

export function getOAuthRedirectUri(
  provider: string,
  locationLike?: { protocol?: string; hostname?: string; port?: string },
): string {
  if (provider === "codex") return "http://localhost:1455/auth/callback";
  if (provider === "xai") return "http://127.0.0.1:56121/callback";

  const protocol =
    locationLike?.protocol ||
    (typeof window !== "undefined" ? window.location.protocol : "http:");
  const port =
    locationLike?.port ||
    (typeof window !== "undefined" ? window.location.port : "14045") ||
    (protocol === "https:" ? "443" : "80");
  const hostname =
    locationLike?.hostname ||
    (typeof window !== "undefined" ? window.location.hostname : "localhost");
  const callbackHost =
    hostname === "127.0.0.1" || hostname === "localhost" ? hostname : "localhost";
  return `http://${callbackHost}:${port}/callback`;
}

export async function startOAuth(
  provider: string,
  redirectUri = getOAuthRedirectUri(provider),
  meta?: Record<string, string | number | boolean | undefined>,
) {
  const params: Record<string, string | number | boolean> = {
    redirect_uri: redirectUri,
  };
  for (const [key, value] of Object.entries(meta || {})) {
    if (value !== undefined) params[key] = value;
  }
  const { data } = await api.get<OAuthAuthData>(
    `/oauth/${provider}/authorize`,
    { params },
  );
  return data;
}

export async function startOAuthProxy(
  provider: string,
  options: { appPort: string | number },
) {
  const { data } = await api.get<OAuthProxyStart>(
    `/oauth/${provider}/start-proxy`,
    { params: { app_port: String(options.appPort) } },
  );
  return data;
}

export async function registerOAuthSession(
  provider: string,
  body: { state: string; codeVerifier: string; redirectUri: string },
) {
  const { data } = await api.post<{ success?: boolean }>(
    `/oauth/${provider}/register-session`,
    body,
  );
  return data;
}

export async function pollOAuthStatus(provider: string, state: string) {
  const { data } = await api.get<OAuthSessionStatus>(
    `/oauth/${provider}/poll-status`,
    { params: { state } },
  );
  return data;
}

export async function stopOAuthProxy(provider: string) {
  const { data } = await api.get<{ success?: boolean }>(
    `/oauth/${provider}/stop-proxy`,
  );
  return data;
}

export function oauthStatusIsDone(status: OAuthSessionStatus["status"]): boolean {
  return status === "done";
}

export function oauthStatusIsError(status: OAuthSessionStatus["status"]): boolean {
  return status === "error";
}

export function oauthStatusIsTerminal(status: OAuthSessionStatus["status"]): boolean {
  return oauthStatusIsDone(status) || oauthStatusIsError(status);
}

export async function startDeviceCode(
  provider: string,
  options?: {
    authMethod?: "builder-id" | "idc";
    region?: string;
    startUrl?: string;
  },
) {
  const params: Record<string, string> = {};
  if (options?.authMethod) params.auth_method = options.authMethod;
  if (options?.region) params.region = options.region;
  if (options?.startUrl) params.start_url = options.startUrl;
  const { data } = await api.get<{
    deviceCode?: string;
    device_code?: string;
    userCode?: string;
    user_code?: string;
    verificationUri?: string;
    verification_uri?: string;
    verificationUriComplete?: string;
    verification_uri_complete?: string;
    interval?: number;
    expiresIn?: number;
    expires_in?: number;
    codeVerifier?: string;
    state?: string;
    [key: string]: unknown;
  }>(`/oauth/${provider}/device-code`, Object.keys(params).length ? { params } : undefined);
  return data;
}

export async function pollDeviceCode(
  provider: string,
  body: {
    deviceCode: string;
    codeVerifier?: string;
    displayName?: string;
    email?: string;
  }
) {
  const { data } = await api.post<{
    success: boolean;
    pending?: boolean;
    error?: string;
    connection?: Connection;
  }>(`/oauth/${provider}/poll`, body);
  return data;
}

export async function exchangeOAuth(
  provider: string,
  body: {
    code: string;
    redirectUri?: string;
    codeVerifier?: string;
    state?: string;
    displayName?: string;
    email?: string;
  }
) {
  const { data } = await api.post<{
    success: boolean;
    connection?: Connection;
    error?: string;
  }>(`/oauth/${provider}/exchange`, body);
  return data;
}

export async function importToken(
  provider: string,
  body: {
    accessToken: string;
    refreshToken?: string;
    machineId?: string;
    email?: string;
    displayName?: string;
  }
) {
  if (provider === "codex") {
    const { data } = await api.post<{
      success: boolean;
      connection?: Connection;
      error?: string;
    }>("/oauth/codex/import-token", {
      accessToken: body.accessToken,
      name: body.displayName,
    });
    return data;
  }
  if (provider === "cursor") {
    if (!body.machineId) {
      throw new Error("Cursor import requires a Machine ID");
    }
    const { data } = await api.post<{
      success: boolean;
      connection?: Connection;
      error?: string;
    }>("/oauth/cursor/import", {
      accessToken: body.accessToken,
      machineId: body.machineId,
    });
    return data;
  }

  return {
    success: false,
    error: `Import token is not supported for "${provider}" — use OAuth or device flow`,
  };
}

export async function autoImportCursor() {
  const { data } = await api.get<{
    found: boolean;
    accessToken?: string;
    machineId?: string;
    error?: string;
  }>("/oauth/cursor/auto-import");
  return data;
}

export async function createKiroApiKey(body: {
  apiKey: string;
  region?: string;
  name?: string;
  autoName?: boolean;
}) {
  const { data } = await api.post<{
    success: boolean;
    connection?: Connection;
    error?: string;
  }>("/oauth/kiro/api-key", body);
  return data;
}

export async function importKiroToken(body: {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
  region?: string;
  authMethod?: "builder-id" | "idc";
  profileArn?: string;
  name?: string;
  autoName?: boolean;
}) {
  const { data } = await api.post<{
    success: boolean;
    connection?: Connection;
    error?: string;
  }>("/oauth/kiro/import", body);
  return data;
}

export async function importKiroCliProxy(body: {
  cliProxyAuth: Record<string, unknown>;
  name?: string;
  autoName?: boolean;
}) {
  const { data } = await api.post<{
    success: boolean;
    connection?: Connection;
    error?: string;
  }>("/oauth/kiro/import-cli-proxy", body);
  return data;
}

export async function importModels(body: {
  connectionId?: string;
  provider?: string;
  baseUrl?: string;
  apiKey?: string;
}) {
  const url = body.baseUrl?.trim();
  if (!url) {
    return {
      ok: false,
      success: false,
      message: "No upstream base URL to import models from",
      models: [] as string[],
    };
  }
  const type = body.provider?.toLowerCase().includes("openrouter")
    ? "openrouter-free"
    : body.provider?.toLowerCase().includes("opencode")
      ? "opencode-free"
      : body.provider?.toLowerCase().includes("mimo")
        ? "mimo-free"
        : "openrouter-free";
  try {
    const { data } = await api.get<{
      data?: Array<{ id: string; name?: string }>;
      error?: string;
    }>("/providers/suggested-models", {
      params: { url, type },
    });
    const list = (data.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => Boolean(id));
    return {
      ok: list.length > 0,
      success: list.length > 0,
      message: list.length
        ? `Found ${list.length} models`
        : "No models matched the catalog filter",
      models: list,
      count: list.length,
    };
  } catch (err) {
    return {
      ok: false,
      success: false,
      message: (err as { message?: string })?.message || "Import failed",
      error: (err as { message?: string })?.message || "Import failed",
      models: [] as string[],
    };
  }
}
