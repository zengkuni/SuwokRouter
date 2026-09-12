import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import {
  getProviderAlias,
  isAnthropicCompatibleProvider,
  isOpenAICompatibleProvider,
} from "@/shared/constants/providers";
import { getActiveProviderRows, getCombos, getCustomModels } from "@/lib/localDb";
import { getDisabledModels } from "@/lib/disabledModelsDb";
import { resolveKiroModels } from "open-sse/services/kiroModels.js";
import { resolveKimchiModels } from "open-sse/services/kimchiModels.js";
import { resolveQoderModels } from "open-sse/services/qoderModels.js";
import { resolveCopilotModels } from "open-sse/services/copilotModels.js";
import { resolveClinepassModels } from "open-sse/services/clinepassModels.js";
import { resolveGrokCliModels } from "open-sse/services/grokCliModels.js";
import { resolveCursorModels } from "open-sse/services/cursorModels.js";
import { updateProviderCredentials } from "@/sse/services/tokenRefresh";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { getCapabilitiesForModel } from "open-sse/providers/capabilities.js";
import { getThinkingLevels } from "open-sse/providers/thinkingLevels.js";
import { PROVIDERS } from "open-sse/config/providers.js";
import { AGENTROUTER_MODELS_URL, AGENTROUTER_OPENAI_HEADERS } from "open-sse/providers/shared.js";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const MODELS_ERROR = publicError("provider", "Unable to list models");

const LIVE_MODEL_RESOLVERS = {
  kiro: async (conn) => {
    const result = await resolveKiroModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  qoder: async (conn) => {
    const result = await resolveQoderModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      email: conn.email,
      displayName: conn.displayName,
      providerSpecificData: conn.providerSpecificData || {}
    });
    if (!result?.models?.length) return null;
    return {
      models: result.models.map((m) => ({ id: m.id, name: m.name })),
    };
  },
  kimchi: async (conn) => {
    const result = await resolveKimchiModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
      providerSpecificData: conn.providerSpecificData || {}
    }, { log: console });
    return result?.models?.length ? { models: result.models } : null;
  },
  github: async (conn) => {
    const result = await resolveCopilotModels({
      accessToken: conn.accessToken,
      refreshToken: conn.refreshToken,
      providerSpecificData: conn.providerSpecificData || {}
    }, {
      log: console,
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          copilotToken: refreshed.copilotToken,
          copilotTokenExpiresAt: refreshed.copilotTokenExpiresAt,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  clinepass: async (conn) => {
    const result = await resolveClinepassModels({
      accessToken: conn.accessToken,
      apiKey: conn.apiKey,
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  "grok-cli": async (conn) => {
    const proxy = await resolveConnectionProxyConfig(conn.providerSpecificData || {});
    const result = await resolveGrokCliModels({
      ...conn,
      connectionId: conn.id,
    }, {
      log: console,
      proxyOptions: {
        connectionProxyEnabled: proxy.connectionProxyEnabled === true,
        connectionProxyUrl: proxy.connectionProxyUrl || "",
          connectionNoProxy: proxy.connectionNoProxy || "",
          relayUrl: proxy.relayUrl || "",
          relayToken: proxy.relayToken || "",
          vercelRelayUrl: proxy.vercelRelayUrl || "",
          strictProxy: proxy.strictProxy === true,
          proxyPoolUnavailable: proxy.proxyPoolUnavailable === true,
          proxyPoolError: proxy.proxyPoolError || "",
        },
      onCredentialsRefreshed: async (refreshed) => {
        await updateProviderCredentials(conn.id, {
          ...refreshed,
          existingProviderSpecificData: conn.providerSpecificData || {},
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
  cursor: async (conn) => {
    const result = await resolveCursorModels({
      accessToken: conn.accessToken,
      providerSpecificData: conn.providerSpecificData || {},
    }, {
      log: console,
      onAuthFailure: async ({ status }) => {
        await updateProviderCredentials(conn.id, {
          testStatus: "stale",
          lastError: `Cursor credentials rejected (${status}); re-authenticate Cursor.`,
          lastErrorAt: new Date().toISOString(),
          errorCode: status,
        });
      },
    });
    return result?.models?.length ? { models: result.models } : null;
  },
};

const parseOpenAIStyleModels = (data) => {
  if (Array.isArray(data)) return data;
  return data?.data || data?.models || data?.results || [];
};

export function stripKnownModelPrefix(modelId, prefixes) {
  let normalized = String(modelId || "").trim();
  const knownPrefixes = [...new Set(
    prefixes.map((prefix) => String(prefix || "").trim()).filter(Boolean),
  )];
  let changed = true;
  while (changed && normalized) {
    changed = false;
    for (const prefix of knownPrefixes) {
      if (!normalized.startsWith(`${prefix}/`)) continue;
      normalized = normalized.slice(prefix.length + 1).trim();
      changed = true;
      break;
    }
  }
  return normalized;
}

const INTERNAL_MODELS_FETCH_HEADER = "x-swayrouter-internal-models-fetch";
const LLM_KIND = "llm";

function normalizedCustomModelId(value) {
  return String(value || "")
    .trim()
    .replace(/^(?:clinepass|cline-pass)\//i, "")
    .toLowerCase();
}

async function fetchCompatibleModelIds(connection) {
  if (!connection?.apiKey) return [];

  const configuredBaseUrl = typeof connection?.providerSpecificData?.baseUrl === "string"
    ? connection.providerSpecificData.baseUrl.trim()
    : "";
  const registryBaseUrl = typeof PROVIDERS[connection.provider]?.baseUrl === "string"
    ? PROVIDERS[connection.provider].baseUrl.replace(/\/chat\/completions\/?$/i, "")
    : "";
  const baseUrl = (configuredBaseUrl || registryBaseUrl).replace(/\/$/, "");

  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (connection.provider === "agentrouter") {
    url = AGENTROUTER_MODELS_URL;
    headers.Authorization = `Bearer ${connection.apiKey}`;
    Object.assign(headers, AGENTROUTER_OPENAI_HEADERS);
  } else if (isOpenAICompatibleProvider(connection.provider)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider)) {
    if (url.endsWith("/messages/models")) {
      url = url.slice(0, -9);
    } else if (url.endsWith("/messages")) {
      url = `${url.slice(0, -9)}/models`;
    }
    headers["x-api-key"] = connection.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: "GET",
      headers: { ...headers, [INTERNAL_MODELS_FETCH_HEADER]: "1" },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) return [];

    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);

    return Array.from(
      new Set(
        rawModels
          .map((model) => model?.id || model?.name || model?.model)
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "")
      )
    );
  } catch {
    return [];
  }
}

function providerMatchesKinds(_providerId, kindFilter) {
  return kindFilter.includes(LLM_KIND);
}

function comboMatchesKinds(combo, kindFilter) {
  const kind = combo?.kind || LLM_KIND;
  return kindFilter.includes(kind);
}

export async function buildModelsList(kindFilter, options = {}) {

  const skipDynamicFetch = options.skipDynamicFetch === true;
  let connections = [];
  try {

    connections = await getActiveProviderRows();
  } catch (e) {
    console.log("Could not fetch providers, returning all models");
  }

  let combos = [];
  try {
    combos = await getCombos();
  } catch (e) {
    console.log("Could not fetch combos");
  }

  let customModels = [];
  try {
    customModels = await getCustomModels();
  } catch (e) {
    console.log("Could not fetch custom models");
  }

  let disabledByAlias = {};
  try {
    disabledByAlias = await getDisabledModels();
  } catch (e) {
    console.log("Could not fetch disabled models");
  }
  const isDisabled = (alias, modelId) => Array.isArray(disabledByAlias[alias]) && disabledByAlias[alias].includes(modelId);

  const activeConnectionByProvider = new Map();
  for (const conn of connections) {
    if (!activeConnectionByProvider.has(conn.provider)) {
      activeConnectionByProvider.set(conn.provider, conn);
    }
  }

  const models = [];

  for (const combo of combos) {
    if (!comboMatchesKinds(combo, kindFilter)) continue;
    const entry = {
      id: combo.name,
      object: "model",
      owned_by: "combo",
    };
    if (combo.kind === "webSearch" || combo.kind === "webFetch") {
      entry.kind = combo.kind;
    }
    models.push(entry);
  }

  if (connections.length > 0) {
    for (const [providerId, conn] of activeConnectionByProvider.entries()) {
      if (!providerMatchesKinds(providerId, kindFilter)) continue;

      const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
      const outputAlias = (
        conn?.providerSpecificData?.prefix
        || getProviderAlias(providerId)
        || staticAlias
      ).trim();
      const providerModels = PROVIDER_MODELS[staticAlias] || [];
      const enabledModels = conn?.providerSpecificData?.enabledModels;
      const hasExplicitEnabledModels =
        Array.isArray(enabledModels) && enabledModels.length > 0;
      const isCompatibleProvider =
        providerId === "agentrouter"
        || isOpenAICompatibleProvider(providerId)
        || isAnthropicCompatibleProvider(providerId);

      let liveCapabilitiesById = new Map();
      let liveThinkingLevelsById = new Map();

      let rawModelIds = hasExplicitEnabledModels
        ? Array.from(
            new Set(
              enabledModels.filter(
                (modelId) => typeof modelId === "string" && modelId.trim() !== "",
              ),
            ),
          )
        : providerModels.map((model) => model.id);

      if (isCompatibleProvider && rawModelIds.length === 0 && !skipDynamicFetch) {
        rawModelIds = await fetchCompatibleModelIds(conn);
      }

      const liveResolver = LIVE_MODEL_RESOLVERS[providerId];
      if (liveResolver && !hasExplicitEnabledModels) {
        try {
          const live = await liveResolver(conn);
          if (live?.models?.length) {
            const liveModelIds = live.models.map((m) => m.id);
            const preserveStaticCatalog = providerId === "grok-cli";
            rawModelIds = preserveStaticCatalog
              ? Array.from(new Set([...rawModelIds, ...liveModelIds]))
              : liveModelIds;
            liveCapabilitiesById = new Map(
              live.models
                .filter((m) => m?.id && m.capabilities)
                .map((m) => [m.id, m.capabilities])
            );
            liveThinkingLevelsById = new Map(
              live.models
                .filter((m) => m?.id && Array.isArray(m.thinkingLevels))
                .map((m) => [m.id, m.thinkingLevels])
            );
          }
        } catch (err) {
          console.log(`Live model fetch failed for ${providerId}: ${err?.message || err}`);
        }
      }

      const providerPrefixes = [outputAlias, staticAlias, providerId];
      const modelIds = rawModelIds
        .map((modelId) => stripKnownModelPrefix(modelId, providerPrefixes))
        .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

      const customModelIds = customModels
        .filter((m) => {
          if (!m?.id) return false;
          if (!kindFilter.includes(LLM_KIND)) return false;
          const alias = m.providerAlias;
          return alias === staticAlias || alias === outputAlias || alias === providerId;
        })
        .map((m) => {
          return stripKnownModelPrefix(m.id, providerPrefixes);
        })
        .filter((modelId) => modelId !== "");

      const mergedModelIds = Array.from(new Set([...modelIds, ...customModelIds]));

      for (const modelId of mergedModelIds) {

        if (!kindFilter.includes(LLM_KIND)) continue;
        if (isDisabled(outputAlias, modelId) || isDisabled(staticAlias, modelId)) continue;

        const normalizedModelId = typeof modelId === "string"
          ? modelId.replace(/^(?:clinepass|cline-pass)\//, "")
          : modelId;
        const model = {
          id: `${outputAlias}/${normalizedModelId}`,
          object: "model",
          owned_by: outputAlias,
        };

        const customModel = customModels.find((candidate) => {
          if (!candidate?.id) return false;
          const alias = String(candidate.providerAlias || "").trim().toLowerCase();
          const aliases = new Set([staticAlias, outputAlias, providerId].map((value) => String(value).trim().toLowerCase()));
          return aliases.has(alias)
            && normalizedCustomModelId(stripKnownModelPrefix(candidate.id, providerPrefixes)) === normalizedCustomModelId(normalizedModelId);
        });
        const customCapabilities = customModel?.capabilities || null;
        const caps = customModel
          ? getCapabilitiesForModel(providerId, modelId, customCapabilities)
          : liveCapabilitiesById.get(modelId) || getCapabilitiesForModel(providerId, modelId);
        if (caps) model.capabilities = caps;
        const thinkingLevels = customModel
          ? getThinkingLevels(providerId, modelId, customCapabilities)
          : liveThinkingLevelsById.get(modelId)
            || getThinkingLevels(providerId, modelId, liveCapabilitiesById.get(modelId) || null);
        if (thinkingLevels) model.thinkingLevels = thinkingLevels;
        models.push(model);
      }
    }
  }

  const dedupedModels = [];
  const seenModelIds = new Set();
  for (const model of models) {
    if (!model?.id || seenModelIds.has(model.id)) continue;
    seenModelIds.add(model.id);
    dedupedModels.push(model);
  }

  return dedupedModels;
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

export async function GET(request) {
  try {
    const skipDynamicFetch = request?.headers?.get(INTERNAL_MODELS_FETCH_HEADER) === "1";
    const data = await buildModelsList([LLM_KIND], { skipDynamicFetch });
    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    logRouteError("Models", error);
    return Response.json(
      { error: { message: MODELS_ERROR, type: "server_error" } },
      { status: 500 }
    );
  }
}
