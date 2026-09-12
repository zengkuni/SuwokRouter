import "open-sse/index.js";

import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { USAGE_APIKEY_PROVIDERS } from "@/shared/constants/providers";
import { logRouteError } from "@/lib/errors/publicError";

const USAGE_ERROR = "Provider usage request failed";

const USAGE_MESSAGE_PATTERNS = [
  /^Usage API not implemented for [a-z0-9-]+$/i,
  /^[A-Za-z0-9 ()+.-]+ connected\.(?: .*)?$/,
  /^[A-Za-z0-9 ()+.-]+ access token or API key not available\.$/,
  /^[A-Za-z0-9 ()+.-]+ API key not available\..*$/,
  /^[A-Za-z0-9 ()+.-]+ authentication expired\..*$/,
  /^[A-Za-z0-9 ()+.-]+ credential invalid or expired\.$/,
  /^[A-Za-z0-9 ()+.-]+ usage request failed\.$/,
];

function isSafeUsageMessage(value) {
  return typeof value === "string" && USAGE_MESSAGE_PATTERNS.some((pattern) => pattern.test(value));
}

function sanitizeQuota(quota) {
  if (!quota || typeof quota !== "object" || Array.isArray(quota)) return null;
  const safe = {};
  for (const key of ["used", "total", "remaining", "remainingPercentage"]) {
    if (Number.isFinite(Number(quota[key]))) safe[key] = Number(quota[key]);
  }
  if (typeof quota.resetAt === "string") safe.resetAt = quota.resetAt;
  if (quota.unlimited === true) safe.unlimited = true;
  if (typeof quota.recurring === "boolean") safe.recurring = quota.recurring;
  if (typeof quota.unit === "string" && quota.unit.length <= 32) safe.unit = quota.unit;
  return safe;
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return { message: USAGE_ERROR };
  }
  const safe = {};
  if (typeof usage.plan === "string" && usage.plan.length <= 100) safe.plan = usage.plan;
  if (typeof usage.message === "string" && isSafeUsageMessage(usage.message)) safe.message = usage.message;
  if (typeof usage.limitReached === "boolean") safe.limitReached = usage.limitReached;
  if (typeof usage.reviewLimitReached === "boolean") safe.reviewLimitReached = usage.reviewLimitReached;
  if (usage.resetCredits && typeof usage.resetCredits === "object" && !Array.isArray(usage.resetCredits)) {
    safe.resetCredits = {
      availableCount: Number.isFinite(Number(usage.resetCredits.availableCount))
        ? Math.max(0, Number(usage.resetCredits.availableCount))
        : 0,
    };
  }
  if (usage.quotas && typeof usage.quotas === "object" && !Array.isArray(usage.quotas)) {
    const quotas = {};
    for (const [name, quota] of Object.entries(usage.quotas)) {
      if (typeof name !== "string" || name.length > 100) continue;
      const sanitized = sanitizeQuota(quota);
      if (sanitized) quotas[name] = sanitized;
    }
    if (Object.keys(quotas).length > 0) safe.quotas = quotas;
  }
  if (Object.keys(safe).length === 0) safe.message = USAGE_ERROR;
  return safe;
}

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];
function isAuthExpiredMessage(usage) {
  if (!usage?.message) return false;
  const msg = usage.message.toLowerCase();
  return AUTH_EXPIRED_PATTERNS.some((p) => msg.includes(p));
}

export async function refreshAndUpdateCredentials(connection, force = false, proxyOptions = null) {
  const executor = getExecutor(connection.provider);

  const credentials = {
    accessToken: connection.accessToken,
    refreshToken: connection.refreshToken,
    idToken: connection.idToken,
    expiresAt: connection.expiresAt || connection.tokenExpiresAt,
    lastRefreshAt: connection.lastRefreshAt,
    connectionId: connection.id,
    providerSpecificData: connection.providerSpecificData,

    copilotToken: connection.providerSpecificData?.copilotToken,
    copilotTokenExpiresAt: connection.providerSpecificData?.copilotTokenExpiresAt,
  };

  const needsRefresh = force || executor.needsRefresh(credentials);

  if (!needsRefresh) {
    return { connection, refreshed: false };
  }

  const refreshResult = await executor.refreshCredentials(credentials, console, proxyOptions);

  if (!refreshResult) {

    if (connection.accessToken) {
      return { connection, refreshed: false };
    }
    throw new Error("Failed to refresh credentials. Please re-authorize the connection.");
  }

  const now = new Date().toISOString();
  const updateData = {
    updatedAt: now,
  };

  if (refreshResult.accessToken) {
    updateData.accessToken = refreshResult.accessToken;
  }

  if (refreshResult.refreshToken) {
    updateData.refreshToken = refreshResult.refreshToken;
  }

  if (refreshResult.idToken) {
    updateData.idToken = refreshResult.idToken;
  }

  if (refreshResult.lastRefreshAt) {
    updateData.lastRefreshAt = refreshResult.lastRefreshAt;
  }

  if (refreshResult.expiresIn) {
    updateData.expiresAt = new Date(Date.now() + refreshResult.expiresIn * 1000).toISOString();
    updateData.expiresIn = refreshResult.expiresIn;
  } else if (refreshResult.expiresAt) {
    updateData.expiresAt = refreshResult.expiresAt;
  }

  const providerSpecificUpdates = {
    ...(refreshResult.providerSpecificData || {}),
    ...(refreshResult.copilotToken ? { copilotToken: refreshResult.copilotToken } : {}),
    ...(refreshResult.copilotTokenExpiresAt ? { copilotTokenExpiresAt: refreshResult.copilotTokenExpiresAt } : {}),
  };
  if (Object.keys(providerSpecificUpdates).length > 0) {
    updateData.providerSpecificData = {
      ...(connection.providerSpecificData || {}),
      ...providerSpecificUpdates,
    };
  }

  await updateProviderConnection(connection.id, updateData);

  const updatedConnection = {
    ...connection,
    ...updateData,
    providerSpecificData: updateData.providerSpecificData || connection.providerSpecificData,
  };

  return {
    connection: updatedConnection,
    refreshed: true,
  };
}

export async function GET(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;

    connection = await getProviderConnectionById(connectionId);
    if (!connection) {
      return Response.json({ error: "Connection not found" }, { status: 404 });
    }

    const isOAuth = connection.authType === "oauth";
    const isApikeyAuth =
      connection.authType === "apikey" || connection.authType === "api_key";
    const isApikeyEligible =
      isApikeyAuth && USAGE_APIKEY_PROVIDERS.includes(connection.provider);

    if (!isOAuth && !isApikeyEligible) {
      return Response.json({ message: "Usage not available for this connection" });
    }

    const proxyConfig = await resolveConnectionProxyConfig(connection.providerSpecificData);
    const proxyOptions = {
      connectionProxyEnabled: proxyConfig.connectionProxyEnabled === true,
      connectionProxyUrl: proxyConfig.connectionProxyUrl || "",
      connectionNoProxy: proxyConfig.connectionNoProxy || "",
      relayUrl: proxyConfig.relayUrl || "",
      relayToken: proxyConfig.relayToken || "",
      vercelRelayUrl: proxyConfig.vercelRelayUrl || "",
      strictProxy: false,
    };

    if (isOAuth) {
      try {
        const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
        connection = result.connection;
      } catch (refreshError) {
        logRouteError("Usage][Refresh", refreshError);
        return Response.json({
          error: "Credential refresh failed"
        }, { status: 401 });
      }
    }

    let usage = await getUsageForProvider(connection, proxyOptions);

    if (isOAuth && isAuthExpiredMessage(usage) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        usage = await getUsageForProvider(connection, proxyOptions);
      } catch (retryError) {
        console.warn(`[Usage] ${connection.provider}: force refresh failed: ${retryError.message}`);
      }
    }

    return Response.json(sanitizeUsage(usage));
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    logRouteError(`Usage][${provider}`, error);
    return Response.json({ error: USAGE_ERROR }, { status: 500 });
  }
}
