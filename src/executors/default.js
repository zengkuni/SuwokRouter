import { BaseExecutor } from "./base.js";
import { PROVIDERS, PROVIDER_OAUTH } from "../config/providers.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE, selectAnthropicBeta } from "../providers/shared.js";
import { resolveOpenAICompatibleApiType } from "../services/provider.js";
import { OAUTH_ENDPOINTS, buildKimiHeaders } from "../config/appConstants.js";
import { buildClineHeaders } from "../shared/clineAuth.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { injectReasoningContent } from "../utils/reasoningContentInjector.js";
import {
  applyModelAwareParameterPolicy,
  stripUnsupportedParams,
} from "../translator/concerns/paramSupport.js";

const BEARER = { combined: true, header: "Authorization", scheme: "bearer" };
const XAPIKEY = { combined: true, header: "x-api-key", scheme: "raw" };
const AUTH_DESCRIPTORS = Object.fromEntries(
  Object.entries(PROVIDERS)
    .filter(([, t]) => t.auth)
    .map(([id, t]) => [id, t.auth])
);

function setAuth(headers, spec, token) {
  headers[spec.header] = spec.scheme === "bearer" ? `Bearer ${token}` : token;
}

function applyAuth(headers, desc, credentials) {
  if (desc.combined) {

    const token = credentials.apiKey || credentials.accessToken;
    setAuth(headers, desc, token);
    for (const additional of desc.additional || []) {
      setAuth(headers, additional, token);
    }
    if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
    return;
  }

  if (credentials.apiKey) setAuth(headers, desc.apiKey, credentials.apiKey);
  else if (credentials.accessToken) setAuth(headers, desc.oauth, credentials.accessToken);
  if (desc.anthropicVersion && !headers["anthropic-version"]) headers["anthropic-version"] = ANTHROPIC_API_VERSION;
}

const HEADER_HOOKS = {

  kimiHeaders: (h, c) => Object.assign(h, buildKimiHeaders(c?.providerSpecificData?.deviceId)),

  clineHeaders: (h, c) => {
    if (!c?.apiKey && c?.accessToken) {
      Object.assign(h, buildClineHeaders(c.accessToken));
    }
  },
  kilocodeOrg: (h, c) => { if (c.providerSpecificData?.orgId) h["X-Kilocode-OrganizationID"] = c.providerSpecificData.orgId; },
};

const REFRESH_GRANTS = Object.fromEntries(
  Object.entries(PROVIDER_OAUTH)
    .filter(([, o]) => o.refresh)
    .map(([id, o]) => {
      const tokenUrl = o.tokenUrl;
      const encoding = o.refresh.encoding;
      const extraParams = o.refresh.scope ? { scope: o.refresh.scope } : {};
      return [id, {
        encoding,
        url: () => tokenUrl,
        params: (ex) => id === "gemini"
          ? { client_id: ex.config.clientId, client_secret: ex.config.clientSecret, ...extraParams }
          : { client_id: o.clientId, ...extraParams },
      }];
    })
);

export class DefaultExecutor extends BaseExecutor {
  constructor(provider) {
    super(provider, PROVIDERS[provider] || PROVIDERS.openai);
  }

  transformRequest(model, body) {
    const transformed = body;

    if (transformed && typeof transformed === "object") {

      if (this.config.quirks?.dropClientMetadata) {
        delete transformed.client_metadata;
      }
      stripUnsupportedParams(this.provider, model, transformed);
      applyModelAwareParameterPolicy(this.provider, model, transformed, this.config);
    }

    return injectReasoningContent({ provider: this.provider, model, body: transformed });
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {

    const rt = credentials?.runtimeTransport;
    if (rt?.baseUrl) {
      return rt.urlSuffix ? `${rt.baseUrl}${rt.urlSuffix}` : rt.baseUrl;
    }
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = resolveOpenAICompatibleApiType(this.provider, credentials) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }

    if (this.config.format === "gemini") {
      return `${this.config.baseUrl}/${model}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
    }

    if (this.config.urlSuffix) {
      return `${this.config.baseUrl}${this.config.urlSuffix}`;
    }
    const url = this.config.baseUrl;
    if (url?.includes("{accountId}")) {
      const accountId = credentials?.providerSpecificData?.accountId;
      if (!accountId) throw new Error(`${this.provider} requires accountId in providerSpecificData`);
      return url.replace("{accountId}", accountId);
    }
    return url;
  }

  resolveAuthDescriptor() {
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      return { apiKey: { header: "x-api-key", scheme: "raw" }, oauth: { header: "Authorization", scheme: "bearer" }, anthropicVersion: true };
    }
    if (this.config?.format === "claude") {
      return { ...XAPIKEY, anthropicVersion: true };
    }
    return BEARER;
  }

  buildHeaders(credentials, stream = true, url, model) {
    const rt = credentials?.runtimeTransport;
    const headers = { "Content-Type": "application/json", ...(rt ? rt.headers : this.config.headers) };
    const desc = rt?.auth || AUTH_DESCRIPTORS[this.provider] || this.resolveAuthDescriptor();

    applyAuth(headers, desc, credentials);
    for (const hook of desc.hooks || []) HEADER_HOOKS[hook]?.(headers, credentials);

    if (this.provider === "claude" && model) {
      headers["Anthropic-Beta"] = selectAnthropicBeta(model);
    }

    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "";
      const isOfficialAnthropic = baseUrl === "" || baseUrl.includes("api.anthropic.com");
      if (!isOfficialAnthropic) {

        if (credentials.apiKey && !headers["Authorization"]) {
          headers["Authorization"] = `Bearer ${credentials.apiKey}`;
        }
        delete headers["anthropic-dangerous-direct-browser-access"];
        delete headers["Anthropic-Dangerous-Direct-Browser-Access"];
        delete headers["x-app"];
        delete headers["X-App"];

        for (const betaKey of ["anthropic-beta", "Anthropic-Beta"]) {
          if (headers[betaKey]) {
            const filtered = headers[betaKey]
              .split(",")
              .map(s => s.trim())
              .filter(f => f && f !== "claude-code-20250219")
              .join(",");
            if (filtered) {
              headers[betaKey] = filtered;
            } else {
              delete headers[betaKey];
            }
          }
        }
      }
    }

    if (stream) headers["Accept"] = "text/event-stream";
    return headers;
  }

  refreshFromGrant(credentials, proxyOptions) {
    const grant = REFRESH_GRANTS[this.provider];
    const params = { grant_type: "refresh_token", refresh_token: credentials.refreshToken, ...grant.params(this) };
    return grant.encoding === "json"
      ? this.refreshWithJSON(grant.url(), params, proxyOptions)
      : this.refreshWithForm(grant.url(), params, proxyOptions);
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    if (!credentials.refreshToken) return null;

    const refreshers = {
      claude: () => this.refreshFromGrant(credentials, proxyOptions),
      codex: () => this.refreshFromGrant(credentials, proxyOptions),
      gemini: () => this.refreshFromGrant(credentials, proxyOptions),
      kiro: () => this.refreshKiro(credentials.refreshToken, proxyOptions),
      cline: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      clinepass: () => this.refreshCline(credentials.refreshToken, proxyOptions),
      kimi: () => this.refreshKimi(credentials, proxyOptions),
      "kimi-coding": () => this.refreshKimi(credentials, proxyOptions),
      kilocode: () => this.refreshKilocode(credentials.refreshToken, proxyOptions)
    };

    const refresher = refreshers[this.provider];
    if (!refresher) return null;

    try {
      const result = await refresher();
      if (result) log?.info?.("TOKEN", `${this.provider} refreshed`);
      return result;
    } catch (error) {
      log?.error?.("TOKEN", `${this.provider} refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshWithJSON(url, body, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(body)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || body.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshWithForm(url, params, proxyOptions = null) {
    const response = await proxyAwareFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json" },
      body: new URLSearchParams(params)
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || params.refresh_token, expiresIn: tokens.expires_in };
  }

  async refreshKiro(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.kiro.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "kiro-cli/1.0.0" },
      body: JSON.stringify({ refreshToken })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken || refreshToken, expiresIn: tokens.expiresIn };
  }

  async refreshCline(refreshToken, proxyOptions = null) {
    const response = await proxyAwareFetch(PROVIDERS.cline.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ refreshToken, grantType: "refresh_token", clientType: "extension" })
    }, proxyOptions);
    if (!response.ok) return null;
    const payload = await response.json();
    const data = payload?.data || payload;
    const expiresAtIso = data?.expiresAt;
    const expiresIn = expiresAtIso ? Math.max(1, Math.floor((new Date(expiresAtIso).getTime() - Date.now()) / 1000)) : undefined;
    let accessToken = data?.accessToken;
    if (accessToken && !accessToken.startsWith("workos:")) {
      accessToken = `workos:${accessToken}`;
    }
    return { accessToken, refreshToken: data?.refreshToken || refreshToken, expiresIn };
  }

  async refreshKimi(credentials, proxyOptions = null) {
    const refreshToken = credentials.refreshToken;
    const cfg = PROVIDERS.kimi || PROVIDERS["kimi-coding"];
    if (!cfg?.refreshUrl || !cfg?.clientId) return null;
    const kimiHeaders = buildKimiHeaders(credentials?.providerSpecificData?.deviceId);
    const response = await proxyAwareFetch(cfg.refreshUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
        ...kimiHeaders
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: cfg.clientId })
    }, proxyOptions);
    if (!response.ok) return null;
    const tokens = await response.json();
    return { accessToken: tokens.access_token, refreshToken: tokens.refresh_token || refreshToken, expiresIn: tokens.expires_in };
  }

  async refreshKilocode(refreshToken, proxyOptions = null) {

    return null;
  }
}

export default DefaultExecutor;
