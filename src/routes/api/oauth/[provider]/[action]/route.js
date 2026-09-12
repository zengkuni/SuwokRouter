import { NextResponse } from "next/server";
import {
  getProvider,
  generateAuthData,
  exchangeTokens,
  requestDeviceCode,
  pollForToken,
  providerUsesPkce,
  providerRequiresDeviceCodeVerifier,
  resolveProviderName,
} from "@/lib/oauth/providers";
import { createProviderConnection } from "@/models";
import {
  startCodexProxy,
  stopCodexProxy,
  registerCodexSession,
  getCodexSessionStatus,
  clearCodexSession,
  startXaiProxy,
  stopXaiProxy,
  registerXaiSession,
  getXaiSessionStatus,
  clearXaiSession,
  startTraeProxy,
  stopTraeProxy,
  registerTraeSession,
  getTraeSessionStatus,
  clearTraeSession,
  startWindsurfProxy,
  stopWindsurfProxy,
  registerWindsurfSession,
  getWindsurfSessionStatus,
  clearWindsurfSession,
} from "@/lib/oauth/utils/server";
import { detectIdeInstalled } from "@/lib/oauth/utils/ideDetect";
import { logRouteError, publicError } from "@/lib/errors/publicError";

const OAUTH_ERROR = publicError("oauth");
const KIRO_DEVICE_SESSION_TTL_MS = 10 * 60 * 1000;
const kiroDeviceSessions = new Map();

function pruneKiroDeviceSessions(now = Date.now()) {
  for (const [deviceCode, session] of kiroDeviceSessions) {
    if (!session || session.expiresAt <= now) kiroDeviceSessions.delete(deviceCode);
  }
}

function rememberKiroDeviceSession(deviceCode, deviceData) {
  if (!deviceCode) return;
  pruneKiroDeviceSessions();
  kiroDeviceSessions.set(deviceCode, {
    _clientId: deviceData._clientId,
    _clientSecret: deviceData._clientSecret,
    _region: deviceData._region,
    _authMethod: deviceData._authMethod,
    _startUrl: deviceData._startUrl,
    expiresAt: Date.now() + KIRO_DEVICE_SESSION_TTL_MS,
  });
}

function getKiroDeviceSession(deviceCode) {
  pruneKiroDeviceSessions();
  const session = kiroDeviceSessions.get(deviceCode);
  if (!session) return undefined;
  const { expiresAt, ...extraData } = session;
  return extraData;
}

function forgetKiroDeviceSession(deviceCode) {
  if (deviceCode) kiroDeviceSessions.delete(deviceCode);
}

function safeOAuthError(scope, error) {
  logRouteError(scope, error);
  return OAUTH_ERROR;
}

function hasRequiredAuthorizationCodeFields(provider, code, redirectUri, codeVerifier) {
  return Boolean(
    code &&
      redirectUri &&
      (!providerUsesPkce(provider) || codeVerifier),
  );
}

function hasRequiredDevicePollFields(provider, deviceCode, codeVerifier) {
  return Boolean(
    deviceCode &&
      (!providerRequiresDeviceCodeVerifier(provider) || codeVerifier),
  );
}

function isPendingDevicePoll(result) {
  return Boolean(
    result?.pending ||
      result?.error === "authorization_pending" ||
      result?.error === "slow_down",
  );
}

async function completeXaiManualCode(code, state) {
  const session = state ? getXaiSessionStatus(state) : null;
  if (!session) {
    throw new Error("xAI OAuth session not found; restart the login flow and paste the code again");
  }
  if (!code) throw new Error("Missing xAI authorization code");

  try {
    const tokenData = await exchangeTokens(
      "xai",
      code,
      session.redirectUri,
      session.codeVerifier,
      state
    );
    const connection = await createProviderConnection({
      provider: "xai",
      authType: "oauth",
      ...tokenData,
      expiresAt: tokenData.expiresIn
        ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
        : null,
      testStatus: "active",
    });
    clearXaiSession(state);
    stopXaiProxy();
    return {
      id: connection.id,
      provider: connection.provider,
      email: connection.email,
      displayName: connection.displayName,
    };
  } catch (err) {
    clearXaiSession(state);
    stopXaiProxy();
    throw err;
  }
}

export async function GET(request, { params }) {
  try {
    const { provider: requestedProvider, action } = await params;
    const provider = resolveProviderName(requestedProvider);
    const { searchParams } = new URL(request.url);

    if (action === "authorize") {
      const redirectUri = searchParams.get("redirect_uri") || "http://localhost:8080/callback";

      const reservedParams = new Set(["redirect_uri"]);
      const meta = {};
      searchParams.forEach((value, key) => { if (!reservedParams.has(key)) meta[key] = value; });
      const authData = await generateAuthData(provider, redirectUri, Object.keys(meta).length ? meta : undefined);
      return NextResponse.json(authData);
    }

    if (action === "start-proxy") {

      if (provider === "trae") {
        const result = await startTraeProxy();
        return NextResponse.json(result);
      }
      if (provider === "windsurf") {
        const result = await startWindsurfProxy();
        return NextResponse.json(result);
      }
      if (!["codex", "xai"].includes(provider)) {
        return NextResponse.json({ error: "Proxy only supported for codex/xai/trae/windsurf" }, { status: 400 });
      }
      const appPort = searchParams.get("app_port");
      if (!appPort) {
        return NextResponse.json({ error: "Missing app_port" }, { status: 400 });
      }

      const result = provider === "xai"
        ? await startXaiProxy(Number(appPort))
        : await startCodexProxy(Number(appPort));
      return NextResponse.json(result);
    }

    if (action === "poll-status") {
      const state = searchParams.get("state");
      if (!state) {
        return NextResponse.json({ error: "Missing state" }, { status: 400 });
      }
      let session;
      if (provider === "trae") session = getTraeSessionStatus(state);
      else if (provider === "windsurf") session = getWindsurfSessionStatus(state);
      else if (provider === "xai") session = getXaiSessionStatus(state);
      else if (provider === "codex") session = getCodexSessionStatus(state);
      else return NextResponse.json({ error: "Poll only supported for codex/xai/trae/windsurf" }, { status: 400 });
      if (!session) return NextResponse.json({ status: "unknown" });
      if (session.status === "done" || session.status === "error") {
        const payload = { ...session };
        if (provider === "trae") clearTraeSession(state);
        else if (provider === "windsurf") clearWindsurfSession(state);
        else if (provider === "xai") clearXaiSession(state);
        else clearCodexSession(state);
        return NextResponse.json(payload);
      }
      return NextResponse.json({ status: session.status });
    }

    if (action === "stop-proxy") {
      if (provider === "trae") stopTraeProxy();
      else if (provider === "windsurf") stopWindsurfProxy();
      else if (provider === "xai") stopXaiProxy();
      else if (provider === "codex") stopCodexProxy();
      else return NextResponse.json({ error: "Proxy only supported for codex/xai/trae/windsurf" }, { status: 400 });
      return NextResponse.json({ success: true });
    }

    if (action === "ide-status") {

      if (provider !== "trae" && provider !== "windsurf") {
        return NextResponse.json({ error: "ide-status only supported for trae/windsurf" }, { status: 400 });
      }
      const status = await detectIdeInstalled(provider);
      return NextResponse.json(status);
    }

    if (action === "device-code") {
      const providerData = getProvider(provider);
      if (providerData.flowType !== "device_code") {
        return NextResponse.json({ error: "Provider does not support device code flow" }, { status: 400 });
      }

      const authData = await generateAuthData(provider, null);
      const startUrl = searchParams.get("start_url");
      const region = searchParams.get("region");
      const authMethod = searchParams.get("auth_method");
      const deviceOptions = provider === "kiro"
        ? {
            ...(startUrl ? { startUrl } : {}),
            ...(region ? { region } : {}),
            ...(authMethod ? { authMethod } : {}),
          }
        : undefined;

      const deviceData = await requestDeviceCode(
        provider,
        providerRequiresDeviceCodeVerifier(provider)
          ? authData.codeChallenge
          : undefined,
        deviceOptions,
      );

      if (provider === "kiro") {
        const deviceCode = deviceData.device_code || deviceData.deviceCode;
        rememberKiroDeviceSession(deviceCode, deviceData);
      }

      const publicDeviceData = { ...deviceData };
      delete publicDeviceData._clientId;
      delete publicDeviceData._clientSecret;
      delete publicDeviceData._region;
      delete publicDeviceData._authMethod;
      delete publicDeviceData._startUrl;

      return NextResponse.json({
        ...publicDeviceData,

        codeVerifier: deviceData.codeVerifier || authData.codeVerifier,
      });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: safeOAuthError("OAuth][GET", error) }, { status: 500 });
  }
}

export const __test__ = {
  hasRequiredAuthorizationCodeFields,
  hasRequiredDevicePollFields,
  isPendingDevicePoll,
};

export async function POST(request, { params }) {
  try {
    const { provider: requestedProvider, action } = await params;
    const provider = resolveProviderName(requestedProvider);
    let body;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid or empty request body" }, { status: 400 });
    }

    if (action === "register-session") {

      const searchParams = new URL(request.url).searchParams;
      const state = searchParams.get("state") || body?.state;
      if (!state) return NextResponse.json({ error: "Missing state" }, { status: 400 });

      if (provider === "codex" || provider === "xai") {
        const codeVerifier = typeof body?.codeVerifier === "string" ? body.codeVerifier.trim() : "";
        const redirectUri = typeof body?.redirectUri === "string" ? body.redirectUri.trim() : "";
        if (!codeVerifier || !redirectUri) {
          return NextResponse.json({ error: "Missing code verifier or redirect URI" }, { status: 400 });
        }
        const ok = provider === "codex"
          ? registerCodexSession({ state, codeVerifier, redirectUri })
          : registerXaiSession({ state, codeVerifier, redirectUri });
        return NextResponse.json({ success: ok });
      }

      let ok = false;
      if (provider === "trae") ok = registerTraeSession({ state });
      else if (provider === "windsurf") ok = registerWindsurfSession({ state });
      else return NextResponse.json({ error: "register-session only supported for codex/xai/trae/windsurf" }, { status: 400 });
      return NextResponse.json({ success: ok });
    }

    if (action === "exchange") {
      const { code, redirectUri, codeVerifier, state, meta } = body;

      if (provider === "trae" || provider === "windsurf") {
        const token = typeof code === "string" ? code.trim() : "";
        if (!token) {
          return NextResponse.json({ error: "Missing token or callback URL" }, { status: 400 });
        }
        try {
          const tokenData = await exchangeTokens(provider, token, null, null, state);
          const connection = await createProviderConnection({
            provider,
            authType: provider === "windsurf" ? "api_key" : "oauth",
            ...tokenData,
            expiresAt: tokenData.expiresIn
              ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
              : null,
            testStatus: "active",
          });
          return NextResponse.json({
            success: true,
            connection: {
              id: connection.id,
              provider: connection.provider,
              email: connection.email,
              displayName: connection.displayName,
            }
          });
        } catch (err) {
          return NextResponse.json({ error: safeOAuthError("OAuth][Exchange", err) }, { status: 500 });
        }
      }

      if (code && code.startsWith("eyJ") && code.includes(".")) {
        const { extractCodexAccountInfo } = await import("@/lib/oauth/providers");
        const info = extractCodexAccountInfo(code);

        let directPayload = {};
        try {
          const b64 = code.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
          const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
          directPayload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
        } catch {}

        const accountId = info.chatgptAccountId || directPayload.account_id;
        const planType = info.chatgptPlanType || directPayload.plan_type;
        const email = info.email || directPayload.email;

        const providerSpecificData = { authMethod: "access_token" };
        if (accountId) providerSpecificData.chatgptAccountId = accountId;
        if (planType) providerSpecificData.chatgptPlanType = planType;

        const connection = await createProviderConnection({
          provider,
          authType: "access_token",
          accessToken: code,
          email: email || null,
          providerSpecificData,
          testStatus: "active",
        });

        return NextResponse.json({
          success: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
            email: connection.email,
            displayName: connection.displayName,
          }
        });
      }

      if (!hasRequiredAuthorizationCodeFields(provider, code, redirectUri, codeVerifier)) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }

      const tokenData = await exchangeTokens(provider, code, redirectUri, codeVerifier, state, meta);

      const connection = await createProviderConnection({
        provider,
        authType: "oauth",
        ...tokenData,
        expiresAt: tokenData.expiresIn
          ? new Date(Date.now() + tokenData.expiresIn * 1000).toISOString()
          : null,
        testStatus: "active",
      });

      return NextResponse.json({
        success: true,
        connection: {
          id: connection.id,
          provider: connection.provider,
          email: connection.email,
          displayName: connection.displayName,
        }
      });
    }

    if (action === "poll") {
      const { deviceCode, codeVerifier, extraData, displayName } = body;

      if (!deviceCode) {
        return NextResponse.json({ error: "Missing device code" }, { status: 400 });
      }

      if (!hasRequiredDevicePollFields(provider, deviceCode, codeVerifier)) {
        return NextResponse.json({ error: "Missing code verifier" }, { status: 400 });
      }

      const requiresDeviceVerifier = providerRequiresDeviceCodeVerifier(provider);
      const pollExtraData = provider === "kiro"
        ? getKiroDeviceSession(deviceCode)
        : extraData;
      const result = await pollForToken(
        provider,
        deviceCode,
        requiresDeviceVerifier ? codeVerifier : null,
        pollExtraData,
      );

      if (result.success) {

        const providerId = provider === "kimi-coding" ? "kimi" : provider;
        const connection = await createProviderConnection({
          provider: providerId,
          authType: "oauth",
          name: typeof displayName === "string" && displayName.trim()
            ? displayName.trim()
            : undefined,
          autoName: !(typeof displayName === "string" && displayName.trim()),
          ...result.tokens,
          expiresAt: result.tokens.expiresIn
            ? new Date(Date.now() + result.tokens.expiresIn * 1000).toISOString()
            : null,
          testStatus: "active",
        });
        if (provider === "kiro") forgetKiroDeviceSession(deviceCode);

        return NextResponse.json({
          success: true,
          connection: {
            id: connection.id,
            provider: connection.provider,
          }
        });
      }

      const isPending = isPendingDevicePoll(result);
      if (provider === "kiro" && !isPending) forgetKiroDeviceSession(deviceCode);
      const publicStatus = isPending
        ? "authorization_pending"
        : result.error === "access_denied"
          ? "access_denied"
          : result.error === "expired_token"
            ? "expired_token"
            : "poll_failed";
      return NextResponse.json({
        success: false,
        error: publicStatus,
        pending: isPending,
      });
    }

    if (action === "manual-code") {
      if (provider !== "xai") {
        return NextResponse.json({ error: "Manual code only supported for xai" }, { status: 400 });
      }
      const { code, state } = body;
      const connection = await completeXaiManualCode(String(code || "").trim(), String(state || "").trim());
      return NextResponse.json({ success: true, connection });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: safeOAuthError("OAuth][POST", error) }, { status: 500 });
  }
}
