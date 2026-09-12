import "open-sse/index.js";

import { getProviderConnectionById } from "@/lib/localDb";
import { consumeCodexRateLimitResetCredit, getCodexRateLimitResetCredits } from "open-sse/services/usage.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { refreshAndUpdateCredentials } from "../route.js";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const USAGE_ERROR = publicError("provider", "Unable to reset Codex credits");

const AUTH_EXPIRED_PATTERNS = ["expired", "authentication", "unauthorized", "401", "re-authorize"];

function isAuthExpiredResult(result) {
  const values = [result?.message, result?.code, result?.raw?.detail, result?.raw?.error]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return values.some((value) => AUTH_EXPIRED_PATTERNS.some((pattern) => value.includes(pattern)));
}

function isAuthExpiredError(error) {
  return isAuthExpiredResult({ message: error?.message });
}

function getResponseForConsumeResult(result, redeemRequestId) {
  if (result.ok) {
    return Response.json({
      code: "reset",
      reset: true,
      windows_reset: result.windowsReset,
      redeemRequestId,
    });
  }

  if (result.noCredit) {
    return Response.json({
      code: "no_credit",
      reset: false,
      windows_reset: result.windowsReset,
      message: "No Codex reset credits available.",
    }, { status: 409 });
  }

  return Response.json({
    code: "request_failed",
    reset: false,
    windows_reset: result.windowsReset,
    message: "Codex reset credit request failed.",
  }, { status: result.status >= 400 && result.status < 500 ? result.status : 502 });
}

async function getCodexConnection(connectionId) {
  const connection = await getProviderConnectionById(connectionId);
  if (!connection) {
    return { response: Response.json({ error: "Connection not found" }, { status: 404 }) };
  }

  if (connection.provider !== "codex") {
    return { response: Response.json({ error: "Codex reset credits are only available for Codex connections." }, { status: 400 }) };
  }

  const isOAuth = connection.authType === "oauth";
  const isAccessToken = connection.authType === "access_token";
  if (!isOAuth && !isAccessToken) {
    return { response: Response.json({ error: "Codex reset credits require an OAuth or access-token connection." }, { status: 400 }) };
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

  return { connection, isOAuth, proxyOptions };
}

async function refreshCodexConnection(connection, proxyOptions) {
  try {
    const result = await refreshAndUpdateCredentials(connection, false, proxyOptions);
    return { connection: result.connection };
  } catch (refreshError) {
    logRouteError("Usage][CodexReset][Refresh", refreshError);
    return { response: Response.json({ error: "Credential refresh failed" }, { status: 401 }) };
  }
}

export async function GET(_request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    let result;
    try {
      result = await getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    } catch (fetchError) {
      if (!isOAuth || !connection.refreshToken || !isAuthExpiredError(fetchError)) throw fetchError;
      const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
      connection = retryResult.connection;
      result = await getCodexRateLimitResetCredits(connection.accessToken, proxyOptions, connection.providerSpecificData);
    }

    return Response.json({
      availableCount: Number.isFinite(Number(result?.availableCount))
        ? Math.max(0, Number(result.availableCount))
        : 0,
      credits: Array.isArray(result?.credits)
        ? result.credits.map((credit) => ({
            status: typeof credit?.status === "string" ? credit.status : "unknown",
            grantedAt: typeof credit?.grantedAt === "string" ? credit.grantedAt : null,
            expiresAt: typeof credit?.expiresAt === "string" ? credit.expiresAt : null,
          }))
        : [],
    });
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    logRouteError(`Usage][CodexReset][${provider}`, error);
    return Response.json({ error: USAGE_ERROR }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  let connection;
  try {
    const { connectionId } = await params;
    const resolved = await getCodexConnection(connectionId);
    if (resolved.response) return resolved.response;
    ({ connection } = resolved);
    const { isOAuth, proxyOptions } = resolved;

    if (isOAuth) {
      const refreshed = await refreshCodexConnection(connection, proxyOptions);
      if (refreshed.response) return refreshed.response;
      connection = refreshed.connection;
    }

    const redeemRequestId = crypto.randomUUID();
    let consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);

    if (isOAuth && isAuthExpiredResult(consumeResult) && connection.refreshToken) {
      try {
        const retryResult = await refreshAndUpdateCredentials(connection, true, proxyOptions);
        connection = retryResult.connection;
        consumeResult = await consumeCodexRateLimitResetCredit(connection.accessToken, redeemRequestId, proxyOptions);
      } catch (retryError) {
        console.warn(`[Codex Reset Credits] force refresh failed: ${retryError.message}`);
      }
    }

    return getResponseForConsumeResult(consumeResult, redeemRequestId);
  } catch (error) {
    const provider = connection?.provider ?? "unknown";
    logRouteError(`Usage][CodexReset][${provider}`, error);
    return Response.json({ error: USAGE_ERROR }, { status: 500 });
  }
}
