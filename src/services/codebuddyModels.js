import {
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
} from "./tokenRefresh/providers.js";

const CODEBUDDY_CONFIG = {
  "codebuddy-cn": {
    baseUrl: "https://copilot.tencent.com",
    domain: "copilot.tencent.com",
    userAgent: "CLI/2.108.1 CodeBuddy/2.108.1",
  },
  "codebuddy-intl": {
    baseUrl: "https://www.codebuddy.ai",
    domain: "www.codebuddy.ai",
    userAgent: "CLI/2.108.1 CodeBuddy/2.108.1",
  },
};

const MODEL_CATALOG_PATH = "/v3/config";

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function decodeBase64Url(value) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  } catch {
    return "";
  }
}

export function decodeCodeBuddyJwtPayload(token) {
  const parts = asString(token).split(".");
  if (parts.length < 2) return {};
  try {
    return asObject(JSON.parse(decodeBase64Url(parts[1])));
  } catch {
    return {};
  }
}

function getIdentity(token) {
  const payload = decodeCodeBuddyJwtPayload(token);
  return {
    userId: asString(payload.sub || payload.userId || payload.user_id),
    tenantId: asString(payload.tenantId || payload.tenant_id),
    enterpriseId: asString(payload.enterpriseId || payload.enterprise_id),
  };
}

export function buildCodeBuddyModelHeaders(provider, accessToken) {
  const config = CODEBUDDY_CONFIG[provider];
  if (!config) throw new Error(`Unsupported CodeBuddy provider: ${provider}`);

  const identity = getIdentity(accessToken);
  const headers = {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    "X-Requested-With": "XMLHttpRequest",
    Authorization: `Bearer ${accessToken}`,
    "User-Agent": config.userAgent,
    "X-Agent-Intent": "cli",
    "X-IDE-Type": "CLI",
    "X-IDE-Name": "CLI",
    "X-IDE-Version": "2.108.1",
    "X-Product-Version": "4.10.35413651",
    "X-Env-ID": "production",
    "X-Domain": config.domain,
    "X-Product": "SaaS",
  };

  if (identity.userId) headers["X-User-Id"] = identity.userId;
  if (identity.tenantId) headers["X-Tenant-Id"] = identity.tenantId;
  if (identity.enterpriseId) headers["X-Enterprise-Id"] = identity.enterpriseId;
  return headers;
}

function modelId(value) {
  if (typeof value === "string") return value.trim();
  const item = asObject(value);
  return asString(item.id || item.model || item.modelId || item.name);
}

function isChatModel(model) {
  const item = asObject(model);
  const descriptor = [
    modelId(item),
    item.name,
    item.type,
    item.kind,
    item.category,
    ...(Array.isArray(item.tags) ? item.tags : []),
  ]
    .map(asString)
    .join(" ")
    .toLowerCase();

  return !/image|video/.test(descriptor);
}

function normalizeThinkingLevels(model, capabilities) {
  const reasoning = asObject(model.reasoning);
  const raw = reasoning.supportedEfforts
    || reasoning.supportedLevels
    || model.supportedReasoningEfforts
    || model.reasoningEfforts
    || [];
  const values = (Array.isArray(raw) ? raw : [raw])
    .map((value) => asString(value).toLowerCase())
    .filter(Boolean);

  if (!capabilities.reasoning && values.length === 0) return undefined;
  const levels = [...new Set(values)];
  if (capabilities.thinkingCanDisable !== false && !levels.includes("none")) {
    levels.unshift("none");
  }
  return levels.length ? levels : undefined;
}

function normalizeModel(model) {
  const item = asObject(model);
  const id = modelId(item);
  if (!id) return null;

  const reasoning = asObject(item.reasoning);
  const supportedEfforts = reasoning.supportedEfforts
    || reasoning.supportedLevels
    || item.supportedReasoningEfforts
    || item.reasoningEfforts;
  const hasReasoningMetadata = Boolean(
    reasoning && Object.keys(reasoning).length > 0
  );
  const capabilities = {
    vision: item.supportsImages === true || item.supportsVision === true,
    tools: item.supportsToolCall !== false && item.supportsTools !== false,
    reasoning: item.supportsReasoning === true
      || hasReasoningMetadata
      || (Array.isArray(supportedEfforts) && supportedEfforts.length > 0),
    thinkingFormat: "openai",
    ...(typeof reasoning.canDisableThinking === "boolean"
      ? { thinkingCanDisable: reasoning.canDisableThinking }
      : {}),
    ...(Number(item.maxInputTokens) > 0 ? { contextWindow: Number(item.maxInputTokens) } : {}),
    ...(Number(item.maxOutputTokens) > 0 ? { maxOutput: Number(item.maxOutputTokens) } : {}),
  };

  const thinkingLevels = normalizeThinkingLevels(item, capabilities);
  return {
    id,
    name: asString(item.displayName || item.name || id) || id,
    ...(asString(item.description) ? { description: asString(item.description) } : {}),
    ...(thinkingLevels ? { thinkingLevels } : {}),
    capabilities,
  };
}

export function parseCodeBuddyConfig(payload) {
  const root = asObject(payload?.data || payload);
  const catalog = Array.isArray(root.models) ? root.models : [];
  const selected = catalog.filter(isChatModel);

  return selected.map(normalizeModel).filter(Boolean);
}

function refreshForProvider(provider, refreshToken, log) {
  return provider === "codebuddy-cn"
    ? refreshCodebuddyToken(refreshToken, log)
    : refreshCodebuddyIntlToken(refreshToken, log);
}

export async function resolveCodeBuddyModels(credentials, options = {}) {
  const provider = asString(credentials?.provider);
  const config = CODEBUDDY_CONFIG[provider];
  if (!config) return { error: "Unsupported CodeBuddy provider", status: 400 };

  let accessToken = asString(credentials?.accessToken);
  let refreshToken = asString(credentials?.refreshToken);
  const log = options.log;

  async function persistRefresh(refreshed) {
    if (!refreshed?.accessToken) return false;
    accessToken = refreshed.accessToken;
    refreshToken = refreshed.refreshToken || refreshToken;
    if (typeof options.onCredentialsRefreshed === "function") {
      await options.onCredentialsRefreshed(refreshed);
    }
    return true;
  }

  if (!accessToken && refreshToken) {
    let refreshed = null;
    try {
      refreshed = await refreshForProvider(provider, refreshToken, log);
    } catch (error) {
      log?.warn?.("CODEBUDDY_MODELS", "CodeBuddy refresh token exchange failed", {
        provider,
        error: error?.message || String(error),
      });
    }
    if (refreshed?.accessToken) await persistRefresh(refreshed);
  }
  if (!accessToken) return { error: "No valid token found", status: 401 };

  const url = `${config.baseUrl}${MODEL_CATALOG_PATH}`;
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: buildCodeBuddyModelHeaders(provider, accessToken),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if ((response.status === 401 || response.status === 403) && refreshToken) {
      const refreshed = await refreshForProvider(provider, refreshToken, log);
      if (refreshed?.accessToken && await persistRefresh(refreshed)) {
        response = await fetch(url, {
          method: "GET",
          headers: buildCodeBuddyModelHeaders(provider, accessToken),
          ...(options.signal ? { signal: options.signal } : {}),
        });
      }
    }

    if (!response.ok) {
      return {
        models: [],
        status: response.status,
        warning: `CodeBuddy model catalog returned ${response.status}.`,
      };
    }

    const models = parseCodeBuddyConfig(await response.json());
    return models.length
      ? { models }
      : { models: [], warning: "CodeBuddy returned no CLI models." };
  } catch (error) {
    log?.warn?.("CODEBUDDY_MODELS", "CodeBuddy model catalog request failed", {
      provider,
      error: error?.message || String(error),
    });
    return { models: [], warning: "CodeBuddy model catalog is unavailable." };
  }
}
