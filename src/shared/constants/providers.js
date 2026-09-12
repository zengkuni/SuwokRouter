import REGISTRY from "open-sse/providers/registry/index.js";
import { RISK_NOTICE } from "@/shared/constants/providersDisplay";

function buildProviderEntry(r) {
  const display = { ...(r.display || {}) };
  if (display.deprecationNotice === "RISK_NOTICE") display.deprecationNotice = RISK_NOTICE;
  return {
    ...display,
    id: r.id,
    alias: r.uiAlias || r.alias,
    ...(r.hidden ? { hidden: true } : {}),
    ...(r.priority !== undefined ? { priority: r.priority } : {}),
    ...(r.hasFree ? { hasFree: true } : {}),
    ...(r.thinkingConfig ? { thinkingConfig: r.thinkingConfig } : {}),
    ...(r.regions ? { regions: r.regions, defaultRegion: r.defaultRegion } : {}),
    ...(r.hasProviderSpecificData ? { hasProviderSpecificData: true } : {}),
    ...(r.noAuth ? { noAuth: true } : {}),
    ...(r.passthroughModels ? { passthroughModels: true } : {}),
    ...(r.hasOAuth ? { hasOAuth: true } : {}),
    ...(r.authModes ? { authModes: r.authModes } : {}),
    ...(r.authType ? { authType: r.authType } : {}),
    ...(r.authHint ? { authHint: r.authHint } : {}),
  };
}

const byCategory = (cat) => Object.fromEntries(
  REGISTRY.filter(r => r.category === cat).map(r => [r.id, buildProviderEntry(r)])
);

export const APIKEY_PROVIDERS = byCategory("apikey");
export const NO_AUTH_PROVIDERS = byCategory("none");

export const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto"
  }
};

export const OAUTH_PROVIDERS = byCategory("oauth");

export const WEB_COOKIE_PROVIDERS = byCategory("webCookie");

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-";

const BUILTIN_OPENAI_COMPATIBLE_PROVIDERS = new Set(
  REGISTRY
    .filter((entry) => entry.transport?.openaiCompatible === true)
    .map((entry) => entry.id),
);

export function isOpenAICompatibleProvider(providerId) {
  return typeof providerId === "string" && (
    providerId.startsWith(OPENAI_COMPATIBLE_PREFIX)
    || BUILTIN_OPENAI_COMPATIBLE_PROVIDERS.has(providerId)
  );
}

export function isCustomOpenAICompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

export function isCustomEmbeddingProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(CUSTOM_EMBEDDING_PREFIX);
}

export const AI_PROVIDERS = { ...APIKEY_PROVIDERS, ...OAUTH_PROVIDERS, ...WEB_COOKIE_PROVIDERS, ...NO_AUTH_PROVIDERS };

export const AUTH_METHODS = {
  oauth: { id: "oauth" },
  apikey: { id: "apikey" },
  cookie: { id: "cookie" },
};

export function getProviderByAlias(alias) {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.alias === alias || provider.id === alias) {
      return provider;
    }
  }
  return null;
}

export function resolveProviderId(aliasOrId) {
  const provider = getProviderByAlias(aliasOrId);
  return provider?.id || aliasOrId;
}

export function getProviderAlias(providerId) {
  const provider = AI_PROVIDERS[providerId];
  return provider?.alias || providerId;
}

export const ALIAS_TO_ID = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.alias] = p.id;
  return acc;
}, {});

export const ID_TO_ALIAS = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.id] = p.alias;
  return acc;
}, {});

export function getProvidersByKind(kind) {
  if (kind !== "llm") return [];
  return Object.values(AI_PROVIDERS)
    .filter((p) => !p.hidden)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

export const USAGE_SUPPORTED_PROVIDERS = REGISTRY
  .filter(r => r.features?.usage)
  .map(r => r.id);

export const USAGE_APIKEY_PROVIDERS = REGISTRY
  .filter(r => r.features?.usageApikey)
  .map(r => r.id);
