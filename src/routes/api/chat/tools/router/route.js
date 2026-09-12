import { NextResponse } from "@/next/server";
import {
  countProviderConnections,
  getApiKeys,
  getCombos,
  getCustomModels,
  getProviderConnectionsPaged,
  getProviderNodes,
  getProxyPools,
  getSettings,
} from "@/lib/localDb.js";
import { buildModelsList } from "@/routes/api/v1/models/route.js";
import { routerAdmission } from "@/transport/routerAdmission";
import { AI_PROVIDERS } from "@/shared/constants/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_RESULT_ITEMS = 100;
const MODEL_CACHE_TTL_MS = 5_000;
let modelCache = { at: 0, data: [] };

class RouterToolInputError extends Error {}

function limitValue(value, fallback = 25) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_RESULT_ITEMS) {
    throw new RouterToolInputError(`limit must be an integer from 1 to ${MAX_RESULT_ITEMS}`);
  }
  return parsed;
}

function stringValue(value, max = 120) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function providerIdentity(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeConnection(connection) {
  return {
    id: connection.id,
    provider: connection.provider,
    name: connection.name || connection.email || connection.id,
    authType: connection.authType || null,
    isActive: connection.isActive === true,
    testStatus: connection.testStatus || "unknown",
    lastTested: connection.lastTested || null,
    defaultModel: connection.defaultModel || null,
    priority: connection.priority ?? null,
  };
}

function safeApiKey(key) {
  return {
    id: key.id,
    name: key.name || key.id,
    isActive: key.isActive !== false,
    isDefault: key.isDefault === true,
    createdAt: key.createdAt || null,
  };
}

function safeModel(model) {
  const caps = model?.capabilities;
  return {
    id: model.id,
    owned_by: model.owned_by || null,
    capabilities: caps && typeof caps === "object"
      ? {
          vision: caps.vision === true,
          imageOutput: caps.imageOutput === true,
          search: caps.search === true,
          tools: caps.tools !== false,
          reasoning: caps.reasoning === true,
          contextWindow: Number.isFinite(Number(caps.contextWindow)) ? Number(caps.contextWindow) : undefined,
          maxOutput: Number.isFinite(Number(caps.maxOutput)) ? Number(caps.maxOutput) : undefined,
        }
      : undefined,
  };
}

async function getModelsSnapshot() {
  if (Date.now() - modelCache.at < MODEL_CACHE_TTL_MS) return modelCache.data;
  const data = await buildModelsList(["llm"]);
  modelCache = { at: Date.now(), data: Array.isArray(data) ? data : [] };
  return modelCache.data;
}

async function overview() {
  const [counts, nodes, pools, combos, customModels, keys, settings, models] = await Promise.all([
    countProviderConnections(),
    getProviderNodes(),
    getProxyPools(),
    getCombos(),
    getCustomModels(),
    getApiKeys(),
    getSettings(),
    getModelsSnapshot(),
  ]);
  const providerCounts = counts.map((row) => ({
    provider: row.provider,
    total: Number(row.total) || 0,
    active: Number(row.active) || 0,
    inactive: Number(row.inactive) || 0,
  }));
  const registeredProviderTypes = Object.keys(AI_PROVIDERS).length;
  const registeredProviderIds = Object.keys(AI_PROVIDERS).map(providerIdentity).filter(Boolean);
  const customProviderIds = nodes.map((node) => providerIdentity(node.id)).filter(Boolean);
  const configuredProviderIds = providerCounts.map((row) => providerIdentity(row.provider)).filter(Boolean);
  const allProviderIds = new Set([
    ...registeredProviderIds,
    ...customProviderIds,
    ...configuredProviderIds,
  ]);
  const configuredProviders = new Set(configuredProviderIds).size;
  const activeProviders = new Set(
    providerCounts.filter((row) => row.active > 0).map((row) => providerIdentity(row.provider)).filter(Boolean)
  ).size;
  const inactiveOnlyProviders = new Set(
    providerCounts.filter((row) => row.active === 0).map((row) => providerIdentity(row.provider)).filter(Boolean)
  ).size;
  const providersWithInactiveConnections = new Set(
    providerCounts.filter((row) => row.inactive > 0).map((row) => providerIdentity(row.provider)).filter(Boolean)
  ).size;

  return {
    ok: true,
    kind: "router_overview",
    summary: {
      totalModels: models.length,
      totalConnections: providerCounts.reduce((sum, row) => sum + row.total, 0),
      activeConnections: providerCounts.reduce((sum, row) => sum + row.active, 0),
      inactiveConnections: providerCounts.reduce((sum, row) => sum + row.inactive, 0),

      totalProviders: allProviderIds.size,
      registeredProviderTypes,
      configuredProviders,
      activeProviders,
      inactiveOnlyProviders,
      providersWithInactiveConnections,
      connectedProviders: activeProviders,
      providerNodes: nodes.length,
      proxyPools: pools.length,
      combos: combos.length,
      customModels: customModels.length,
      totalApiKeys: keys.length,
      activeApiKeys: keys.filter((key) => key.isActive !== false).length,
    },
    providerCounts,
    admission: routerAdmission.snapshot(),
    settings: {
      requireApiKey: settings.requireApiKey === true,
      requireLogin: settings.requireLogin !== false,
      tunnelDashboardAccess: settings.tunnelDashboardAccess === true,
      mediaProviders: Array.isArray(settings.mediaProviders) ? settings.mediaProviders : [],
    },
  };
}

async function runRouterTool(body = {}) {
  const action = stringValue(body.action, 40).toLowerCase() || "overview";
  if (action === "overview" || action === "status") return overview();

  if (action === "models") {
    const query = stringValue(body.query, 120).toLowerCase();
    const limit = limitValue(body.limit, 50);
    const models = (await getModelsSnapshot()).map(safeModel).filter((model) => {
      if (!query) return true;
      return `${model.id} ${model.owned_by || ""}`.toLowerCase().includes(query);
    });
    return { ok: true, kind: "router_models", total: models.length, models: models.slice(0, limit), truncated: models.length > limit };
  }

  if (action === "connections") {
    const provider = stringValue(body.provider, 80).toLowerCase();
    const activeOnly = body.active_only === true;
    const limit = limitValue(body.limit, 50);
    const page = await getProviderConnectionsPaged({
      ...(provider ? { provider } : {}),
      ...(activeOnly ? { isActive: true } : {}),
      page: 1,
      pageSize: limit,
    });
    return {
      ok: true,
      kind: "router_connections",
      total: page.total,
      connections: page.connections.map(safeConnection),
      truncated: page.total > limit,
    };
  }

  if (action === "api_keys") {
    const includeRevoked = body.include_revoked === true;
    const limit = limitValue(body.limit, 50);
    const all = await getApiKeys();
    const filtered = includeRevoked ? all : all.filter((key) => key.isActive !== false);
    return { ok: true, kind: "router_api_keys", total: filtered.length, keys: filtered.slice(0, limit).map(safeApiKey), truncated: filtered.length > limit };
  }

  throw new RouterToolInputError("Unknown router action. Use overview, models, connections, or api_keys");
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await runRouterTool(body));
  } catch (error) {
    const status = error instanceof RouterToolInputError ? 400 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Router tool failed" }, { status });
  }
}
