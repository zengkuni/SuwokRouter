import REGISTRY from "./registry/index.js";
import type { ProviderService } from "@/types/provider";

export const RISK_NOTICE =
  "Risk Notice: This provider uses a subscription/OAuth session not officially licensed for proxy/router use. Account may be restricted or banned. Use at your own risk.";

export interface ProviderEntry {
  id: string;
  alias: string;
  name: string;
  icon: string;
  color?: string;
  textIcon?: string;
  website?: string;
  notice?: unknown;
  hidden?: boolean;
  category: string;
  service: ProviderService;
  priority?: number;
  hasFree?: boolean;
  thinkingConfig?: unknown;
  regions?: unknown;
  defaultRegion?: unknown;
  hasProviderSpecificData?: boolean;
  noAuth?: boolean;
  passthroughModels?: boolean;
  hasOAuth?: boolean;
  authModes?: string[];
  authType?: string;
  authHint?: string;
  [key: string]: unknown;
}

function buildProviderEntry(r: any): ProviderEntry {
  const display = { ...(r.display || {}) };
  if (display.deprecationNotice === "RISK_NOTICE") display.deprecationNotice = RISK_NOTICE;
  return {
    ...display,
    id: r.id,

    alias: r.uiAlias || r.alias || r.id,
    ...(r.hidden ? { hidden: true } : {}),
    service: "llm",
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

    ...(r.transport ? { transport: r.transport } : {}),
  };
}

const byCategory = (cat: string) =>
  Object.fromEntries(REGISTRY.filter((r: any) => r.category === cat).map((r: any) => [r.id, buildProviderEntry(r)]));

export const OAUTH_PROVIDERS = byCategory("oauth");
export const APIKEY_PROVIDERS = byCategory("apikey");
export const WEB_COOKIE_PROVIDERS = byCategory("webCookie");
export const NO_AUTH_PROVIDERS = byCategory("none");

export const AI_PROVIDERS: Record<string, ProviderEntry> = {
  ...APIKEY_PROVIDERS,
  ...OAUTH_PROVIDERS,
  ...WEB_COOKIE_PROVIDERS,
  ...NO_AUTH_PROVIDERS,
};

export const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000,
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto",
  },
};

export const AUTH_METHODS = {
  oauth: { id: "oauth" },
  apikey: { id: "apikey" },
  cookie: { id: "cookie" },
};

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-";

export function isOpenAICompatibleProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}
export function isAnthropicCompatibleProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}
export function isCustomEmbeddingProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith(CUSTOM_EMBEDDING_PREFIX);
}

export function getProviderByAlias(alias: string): ProviderEntry | null {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.alias === alias || provider.id === alias) return provider;
  }
  return null;
}

export function resolveProviderId(aliasOrId: string): string {
  const provider = getProviderByAlias(aliasOrId);
  return provider?.id || aliasOrId;
}

export function getProviderAlias(providerId: string): string {
  const provider = AI_PROVIDERS[providerId];
  return provider?.alias || providerId;
}

export const ALIAS_TO_ID: Record<string, string> = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.alias] = p.id;
  return acc;
}, {} as Record<string, string>);

export const ID_TO_ALIAS: Record<string, string> = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.id] = p.alias;
  return acc;
}, {} as Record<string, string>);

export function getProvidersByKind(kind: string): ProviderEntry[] {
  if (kind !== "llm") return [];
  return Object.values(AI_PROVIDERS)
    .filter((p) => !p.hidden)
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999));
}

export const USAGE_SUPPORTED_PROVIDERS: string[] = REGISTRY.filter((r: any) => r.features?.usage).map((r: any) => r.id);
export const USAGE_APIKEY_PROVIDERS: string[] = REGISTRY.filter((r: any) => r.features?.usageApikey).map((r: any) => r.id);
