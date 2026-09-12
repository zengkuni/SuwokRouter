import "../../../open-sse-index.js";

import { generatePKCE } from "../utils/pkce.js";
import { extractCodexAccountInfo, fetchKiroProfileArn } from "../providerHelpers.js";

import claude from "./claude.js";
import codex from "./codex.js";
import xai from "./xai.js";
import grokCli from "./grok-cli.js";
import geminiCli from "./gemini-cli.js";
import antigravity from "./antigravity.js";
import qoder from "./qoder.js";
import github from "./github.js";
import kiro from "./kiro.js";
import cursor from "./cursor.js";
import kimi from "./kimi.js";
import kilocode from "./kilocode.js";
import cline from "./cline.js";
import clinepass from "./clinepass.js";
import codebuddyCn from "./codebuddy-cn.js";
import codebuddyIntl from "./codebuddy-intl.js";
import kimchi from "./kimchi.js";
import trae from "./trae.js";
import windsurf from "./windsurf.js";

const PROVIDERS = {
  claude,
  codex,
  xai,
  "grok-cli": grokCli,
  "gemini-cli": geminiCli,
  antigravity,
  qoder,
  github,
  kiro,
  cursor,
  kimi,
  kilocode,
  cline,
  clinepass,
  "codebuddy-cn": codebuddyCn,
  "codebuddy-intl": codebuddyIntl,
  kimchi,
  trae,
  windsurf,
};

const PROVIDER_ALIASES = {
  "kimi-coding": "kimi",
  "grok-build": "grok-cli",
  gb: "grok-cli",
};

function metadataOrEmpty(meta) {
  return meta || {};
}

async function resolveProviderConfig(provider, meta) {
  const context = metadataOrEmpty(meta);
  return provider.prepareConfig
    ? provider.prepareConfig(provider.config, context)
    : provider.config;
}

function createAuthorizationUrl(provider, config, redirectUri, state, codeChallenge, meta) {
  if (provider.flowType === "device_code") return null;
  const context = metadataOrEmpty(meta);
  if (provider.flowType === "authorization_code_pkce") {
    return provider.buildAuthUrl(config, redirectUri, state, codeChallenge, context);
  }
  return provider.buildAuthUrl(config, redirectUri, state, undefined, context);
}

export function resolveProviderName(name) {
  return PROVIDER_ALIASES[name] || name;
}

export function getProviderFlowType(name) {
  return getProvider(name).flowType;
}

export function providerUsesPkce(name) {
  return getProviderFlowType(name) === "authorization_code_pkce";
}

export function providerRequiresDeviceCodeVerifier(name) {
  return getProvider(name).deviceCodePkce === true;
}

export { PROVIDERS };

export { extractCodexAccountInfo, fetchKiroProfileArn };

export function getProvider(name) {
  const key = resolveProviderName(name);
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export function getProviderNames() {
  return Object.keys(PROVIDERS);
}

export async function generateAuthData(providerName, redirectUri, meta) {
  const provider = getProvider(providerName);
  const config = await resolveProviderConfig(provider, meta);
  const { codeVerifier: pkceVerifier, codeChallenge, state: pkceState } = generatePKCE(provider.pkceVerifierBytes);

  const state = config.loginTraceID || pkceState;
  const codeVerifier =
    provider.flowType === "authorization_code_pkce" || provider.deviceCodePkce
      ? pkceVerifier
      : undefined;

  const authUrl = createAuthorizationUrl(provider, config, redirectUri, state, codeChallenge, meta);

  return {
    authUrl,
    state,
    codeVerifier,
    codeChallenge,
    redirectUri,
    flowType: provider.flowType,
    fixedPort: provider.fixedPort,
    callbackPath: provider.callbackPath || "/callback",
  };
}

export async function exchangeTokens(providerName, code, redirectUri, codeVerifier, state, meta) {
  const provider = getProvider(providerName);
  const config = await resolveProviderConfig(provider, meta);

  const tokens = await provider.exchangeToken(
    config,
    code,
    redirectUri,
    codeVerifier,
    state,
    metadataOrEmpty(meta),
  );

  let extra = null;
  if (provider.postExchange) {
    extra = await provider.postExchange(tokens);
  }

  return provider.mapTokens(tokens, extra);
}

export async function requestDeviceCode(providerName, codeChallenge, options) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }
  return provider.requestDeviceCode(provider.config, codeChallenge, options || {});
}

export async function pollForToken(providerName, deviceCode, codeVerifier, extraData) {
  const provider = getProvider(providerName);
  if (provider.flowType !== "device_code") {
    throw new Error(`Provider ${providerName} does not support device code flow`);
  }

  const result = await provider.pollToken(provider.config, deviceCode, codeVerifier, extraData);

  if (!result.ok) {
    return { success: false, error: result.data.error, errorDescription: result.data.error_description };
  }

  const data = result.data;
  if (!data.access_token) {
    const pending = data.error === "authorization_pending" || data.error === "slow_down";
    return pending
      ? {
          success: false,
          error: data.error,
          errorDescription: data.error_description || data.message,
          pending: data.error === "authorization_pending",
        }
      : {
          success: false,
          error: data.error || "no_access_token",
          errorDescription: data.error_description || data.message || "No access token received",
        };
  }

  const extra = provider.postExchange ? await provider.postExchange(data) : null;
  const tokens = provider.mapTokens(data, extra);
  if (resolveProviderName(providerName) === "kiro" && !tokens.providerSpecificData?.profileArn) {
    const profileArn = await fetchKiroProfileArn(tokens.accessToken);
    if (profileArn) tokens.providerSpecificData.profileArn = profileArn;
  }
  return { success: true, tokens };
}

let codexBackfillDone = false;

export async function backfillCodexEmails() {
  if (codexBackfillDone) return;
  codexBackfillDone = true;
  try {
    const { getProviderConnections, updateProviderConnection } = await import("@/lib/localDb");
    const connections = await getProviderConnections();
    const targets = connections.filter((c) => {
      if (c.provider !== "codex" || c.authType !== "oauth" || !c.idToken) return false;
      const hasEmail = !!c.email;
      const hasAccountInfo = !!c.providerSpecificData?.chatgptAccountId;
      return !hasEmail || !hasAccountInfo;
    });
    for (const conn of targets) {
      const info = extractCodexAccountInfo(conn.idToken);
      if (!info.email && !info.chatgptAccountId) continue;
      const patch = {};
      if (!conn.email && info.email) patch.email = info.email;
      if (info.chatgptAccountId || info.chatgptPlanType) {
        patch.providerSpecificData = {
          ...(conn.providerSpecificData || {}),
          chatgptAccountId: info.chatgptAccountId,
          chatgptPlanType: info.chatgptPlanType,
        };
      }
      if (Object.keys(patch).length) {
        await updateProviderConnection(conn.id, patch);
      }
    }
  } catch (err) {
    codexBackfillDone = false;
    console.log("backfillCodexEmails failed:", err?.message || err);
  }
}
