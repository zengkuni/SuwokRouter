import { NextResponse } from "next/server";
import {
  getProviderConnections,
  getProviderConnectionsPaged,
  createProviderConnection,
  getProviderNodeById,
  getProviderNodes,
  getProxyPoolById,
} from "@/models";
import { APIKEY_PROVIDERS } from "@/shared/constants/config";
import { AI_PROVIDERS, WEB_COOKIE_PROVIDERS, isOpenAICompatibleProvider, isCustomOpenAICompatibleProvider, isAnthropicCompatibleProvider, isCustomEmbeddingProvider } from "@/shared/constants/providers";
import { normalizeProviderId, normalizeProviderSpecificData } from "@/lib/providerNormalization";
import {
  refreshCodebuddyToken,
  refreshCodebuddyIntlToken,
} from "@/services/tokenRefresh/providers.js";
import { resolveCodeBuddyModels } from "@/services/codebuddyModels.js";

export const dynamic = "force-dynamic";

const CODEBUDDY_TOKEN_PROVIDERS = new Set(["codebuddy-cn", "codebuddy-intl"]);

function jwtExpiresAt(token) {
  if (typeof token !== "string") return null;
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const exp = Number(payload?.exp);
    return Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function codeBuddyTokenKind(token) {
  if (typeof token !== "string") return "access";
  const part = token.split(".")[1];
  if (!part) return "access";
  try {
    const payload = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    const type = String(payload?.typ || payload?.type || "");
    return /offline|refresh/i.test(type) ? "refresh" : "access";
  } catch {
    return "access";
  }
}

function normalizeProxyConfig(body = {}) {
  const enabled = body?.connectionProxyEnabled === true;
  const url = typeof body?.connectionProxyUrl === "string" ? body.connectionProxyUrl.trim() : "";
  const noProxy = typeof body?.connectionNoProxy === "string" ? body.connectionNoProxy.trim() : "";

  if (enabled && !url) {
    return { error: "Connection proxy URL is required when connection proxy is enabled" };
  }

  return {
    connectionProxyEnabled: enabled,
    connectionProxyUrl: url,
    connectionNoProxy: noProxy,
  };
}

async function normalizeProxyPoolId(proxyPoolId) {
  if (proxyPoolId === undefined || proxyPoolId === null || proxyPoolId === "" || proxyPoolId === "__none__") {
    return { proxyPoolId: null };
  }

  const normalizedId = String(proxyPoolId).trim();
  if (!normalizedId) {
    return { proxyPoolId: null };
  }

  const proxyPool = await getProxyPoolById(normalizedId);
  if (!proxyPool) {
    return { error: "Proxy pool not found" };
  }

  return { proxyPoolId: normalizedId };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider") || undefined;
    const activeParam = searchParams.get("active");
    const isActive = activeParam !== null ? activeParam === "true" || activeParam === "1" : undefined;
    const search = searchParams.get("search") || undefined;
    const pageParam = searchParams.get("page");
    const pageSizeParam = searchParams.get("pageSize");

    const limitParam = searchParams.get("limit");
    const hasPagination = pageParam !== null || pageSizeParam !== null || limitParam !== null;

    let nodeNameMap = {};
    try {
      const nodes = await getProviderNodes();
      for (const node of nodes) {
        if (node.id && node.name) nodeNameMap[node.id] = node.name;
      }
    } catch { }

    const enrichAndSanitize = (c) => {
      const isCompatible = isOpenAICompatibleProvider(c.provider) || isAnthropicCompatibleProvider(c.provider);
      const name = isCompatible
        ? (c.name || nodeNameMap[c.provider] || c.providerSpecificData?.nodeName || c.provider)
        : c.name;
      return {
        ...c,
        name,
        apiKey: undefined,
        accessToken: undefined,
        refreshToken: undefined,
        idToken: undefined,
      };
    };

    if (hasPagination) {

      const isBareLimit = limitParam !== null && pageParam === null && pageSizeParam === null;
      const maxLimit = Math.max(1, Math.min(300, Number(limitParam) || 300));
      const page = isBareLimit ? 1 : (Math.max(1, Number(pageParam) || 1));
      const pageSize = isBareLimit ? maxLimit : (Math.max(1, Math.min(500, Number(pageSizeParam) || 25)));
      const { connections, total } = await getProviderConnectionsPaged({ provider, isActive, search, page, pageSize, limit: isBareLimit ? maxLimit : undefined });
      const totalPages = Math.ceil(total / pageSize);
      const safeConnections = connections.map(enrichAndSanitize);
      return NextResponse.json({
        connections: safeConnections,
        pagination: { page, pageSize, totalItems: total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
      });
    }

    const filter = {};
    if (provider) filter.provider = provider;
    if (isActive !== undefined) filter.isActive = isActive;
    const connections = await getProviderConnections(filter);
    const safeConnections = connections.map(enrichAndSanitize);
    return NextResponse.json({ connections: safeConnections });
  } catch (error) {
    console.log("Error fetching providers:", error);
    return NextResponse.json({ error: "Failed to fetch providers" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const body = await request.json();
    const provider = normalizeProviderId(body.provider);
    const { apiKey, name, displayName, priority, globalPriority, defaultModel, testStatus } = body;
    const normalizedApiKey = typeof apiKey === "string" ? apiKey.trim() : "";
    const normalizedCredentialToken = typeof body.credentialToken === "string" ? body.credentialToken.trim() : "";
    const normalizedAccessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    const normalizedRefreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
    const autoName = body.autoName === true;
    const proxyConfig = normalizeProxyConfig(body);
    if (proxyConfig.error) {
      return NextResponse.json({ error: proxyConfig.error }, { status: 400 });
    }

    const proxyPoolResult = await normalizeProxyPoolId(body.proxyPoolId);
    if (proxyPoolResult.error) {
      return NextResponse.json({ error: proxyPoolResult.error }, { status: 400 });
    }
    const proxyPoolId = proxyPoolResult.proxyPoolId;

    const isWebCookieProvider = !!WEB_COOKIE_PROVIDERS[provider];

    const supportsApiKeyMode = !!AI_PROVIDERS[provider]?.authModes?.includes("apikey");
    const isValidProvider = APIKEY_PROVIDERS[provider] ||
      supportsApiKeyMode ||
      isWebCookieProvider ||
      isOpenAICompatibleProvider(provider) ||
      isAnthropicCompatibleProvider(provider) ||
      isCustomEmbeddingProvider(provider);

    if (!provider || !isValidProvider) {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }
    const hasCodeBuddyCredentials = CODEBUDDY_TOKEN_PROVIDERS.has(provider)
      && Boolean(normalizedCredentialToken || normalizedAccessToken || normalizedRefreshToken);
    if ((normalizedCredentialToken || normalizedAccessToken || normalizedRefreshToken) && !CODEBUDDY_TOKEN_PROVIDERS.has(provider)) {
      return NextResponse.json({ error: "Access tokens and refresh tokens are only supported for CodeBuddy" }, { status: 400 });
    }
    if (hasCodeBuddyCredentials && normalizedApiKey) {
      return NextResponse.json({ error: "Use either an API key or an access token or refresh token, not both" }, { status: 400 });
    }
    if (!normalizedApiKey && !hasCodeBuddyCredentials && provider !== "ollama-local") {
      const missingCredential = CODEBUDDY_TOKEN_PROVIDERS.has(provider)
        ? "Access token or refresh token is required"
        : `${isWebCookieProvider ? "Cookie value" : "API Key"} is required`;
      return NextResponse.json({ error: missingCredential }, { status: 400 });
    }

    const connectionName = typeof name === "string" && name.trim()
      ? name.trim()
      : typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : null;

    let providerSpecificData = normalizeProviderSpecificData(provider, body, body.providerSpecificData);

    if (isCustomOpenAICompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "OpenAI Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        apiType: node.apiType,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isAnthropicCompatibleProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Anthropic Compatible node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    } else if (isCustomEmbeddingProvider(provider)) {
      const node = await getProviderNodeById(provider);
      if (!node) {
        return NextResponse.json({ error: "Custom Embedding node not found" }, { status: 404 });
      }
      providerSpecificData = {
        prefix: node.prefix,
        baseUrl: node.baseUrl,
        nodeName: node.name,
      };
    }

    let accessToken = normalizedAccessToken;
    let refreshToken = normalizedRefreshToken;
    if (normalizedCredentialToken) {
      if (codeBuddyTokenKind(normalizedCredentialToken) === "refresh") {
        refreshToken = normalizedCredentialToken;
      } else {
        accessToken = normalizedCredentialToken;
      }
    }
    const hasCodeBuddyTokens = CODEBUDDY_TOKEN_PROVIDERS.has(provider)
      && Boolean(accessToken || refreshToken);
    let expiresIn;
    let expiresAt = jwtExpiresAt(accessToken);
    if (hasCodeBuddyTokens && !accessToken && refreshToken) {
      const refreshFn = provider === "codebuddy-cn"
        ? refreshCodebuddyToken
        : refreshCodebuddyIntlToken;
      let refreshed = null;
      try {
        refreshed = await refreshFn(refreshToken);
      } catch {
        refreshed = null;
      }
      if (!refreshed?.accessToken) {
        return NextResponse.json({ error: "Refresh token could not be exchanged" }, { status: 400 });
      }
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken || refreshToken;
      expiresIn = Number.isFinite(Number(refreshed.expiresIn)) && Number(refreshed.expiresIn) > 0
        ? Number(refreshed.expiresIn)
        : undefined;
      expiresAt = expiresIn
        ? new Date(Date.now() + expiresIn * 1000).toISOString()
        : jwtExpiresAt(accessToken);
    }

    if (hasCodeBuddyTokens && accessToken) {
      let tokenCheck;
      try {
        tokenCheck = await resolveCodeBuddyModels({
          provider,
          accessToken,
          refreshToken,
        }, {
          onCredentialsRefreshed: async (refreshed) => {
            accessToken = refreshed.accessToken;
            refreshToken = refreshed.refreshToken || refreshToken;
            expiresIn = Number.isFinite(Number(refreshed.expiresIn)) && Number(refreshed.expiresIn) > 0
              ? Number(refreshed.expiresIn)
              : expiresIn;
            expiresAt = expiresIn
              ? new Date(Date.now() + expiresIn * 1000).toISOString()
              : jwtExpiresAt(accessToken);
          },
        });
      } catch {
        tokenCheck = null;
      }

      if (tokenCheck?.status === 401 || tokenCheck?.status === 403) {
        return NextResponse.json(
          { error: "Access token or refresh token is invalid or expired" },
          { status: 400 },
        );
      }
      if (!tokenCheck?.models?.length) {
        return NextResponse.json(
          { error: "CodeBuddy token could not be validated. Check the token and try again." },
          { status: 400 },
        );
      }
    }

    const mergedProviderSpecificData = {
      ...(providerSpecificData || {}),
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled,
      connectionProxyUrl: proxyConfig.connectionProxyUrl,
      connectionNoProxy: proxyConfig.connectionNoProxy,
    };

    if (hasCodeBuddyTokens) mergedProviderSpecificData.authMethod = "token";

    if (proxyPoolId !== null) {
      mergedProviderSpecificData.proxyPoolId = proxyPoolId;
    }

    const newConnection = await createProviderConnection({
      provider,
      authType: hasCodeBuddyTokens ? "oauth" : isWebCookieProvider ? "cookie" : "apikey",
      name: connectionName,
      apiKey: normalizedApiKey || undefined,
      accessToken: accessToken || undefined,
      refreshToken: refreshToken || undefined,
      ...(expiresIn ? { expiresIn } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      autoName,

      priority: priority,
      globalPriority: globalPriority || null,
      defaultModel: defaultModel || null,
      providerSpecificData: mergedProviderSpecificData,
      isActive: true,
      testStatus: testStatus || "unknown",
    });

    const result = { ...newConnection };
    delete result.apiKey;
    delete result.accessToken;
    delete result.refreshToken;
    delete result.idToken;

    return NextResponse.json({ connection: result }, { status: 201 });
  } catch (error) {
    if (
      error?.code === "DUPLICATE_API_KEY" ||
      error?.code === "DUPLICATE_CONNECTION_NAME"
    ) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: 409 }
      );
    }
    console.log("Error creating provider:", error);
    return NextResponse.json({ error: "Failed to create provider" }, { status: 500 });
  }
}
