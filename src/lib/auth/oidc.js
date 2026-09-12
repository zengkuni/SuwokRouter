import crypto from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getSettings } from "@/lib/localDb";
import { env } from "@/lib/env";

export const OIDC_COOKIE_NAMES = {
  state: "oidc_state",
  nonce: "oidc_nonce",
  verifier: "oidc_code_verifier",
};

const DEFAULT_SCOPES = "openid profile email";
const DEFAULT_LOGIN_LABEL = "Sign in with OIDC";
export const OIDC_FETCH_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url, options = {}, timeoutMs = OIDC_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`OIDC request timeout after ${timeoutMs}ms`)), timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  try {
    return await fetch(url, { ...options, signal });
  } finally {
    clearTimeout(timer);
  }
}

function trimTrailingSlashes(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

function normalizeScopes(value) {
  return (value || DEFAULT_SCOPES).trim() || DEFAULT_SCOPES;
}

export function getPublicOrigin(request) {
  const configuredBaseUrl = env.baseUrl;
  if (configuredBaseUrl) {
    try {
      const origin = new URL(configuredBaseUrl);
      if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
        throw new Error("BASE_URL must be an HTTP(S) origin");
      }
      return trimTrailingSlashes(origin.origin);
    } catch {
      throw new Error("BASE_URL must be a valid HTTP(S) origin");
    }
  }

  const viaTrustedProxy = request?.headers?.get?.("x-swayrouter-via-proxy") === "1";
  const forwardedProto = env.trustProxy && viaTrustedProxy
    ? request?.headers?.get?.("x-forwarded-proto") || ""
    : "";
  const forwardedHost = env.trustProxy && viaTrustedProxy
    ? request?.headers?.get?.("x-forwarded-host") || ""
    : "";
  const host = forwardedHost || request?.headers?.get?.("host") || "";
  if (host) {
    const protocol = (forwardedProto || new URL(request.url).protocol || "http:").replace(/:$/, "");
    const origin = new URL(`${protocol}://${host}`);
    if (!["http:", "https:"].includes(origin.protocol) || origin.username || origin.password) {
      throw new Error("Unable to determine a valid public origin");
    }
    return trimTrailingSlashes(origin.origin);
  }

  return trimTrailingSlashes(new URL(request.url).origin);
}

export function isOidcConfigured(settings) {
  return !!(
    trimTrailingSlashes(settings?.oidcIssuerUrl) &&
    (settings?.oidcClientId || "").trim() &&
    (settings?.oidcClientSecret || "").trim()
  );
}

export async function getOidcRuntimeConfig() {
  const settings = await getSettings();
  if (!["oidc", "both"].includes(settings.authMode) || !isOidcConfigured(settings)) return null;

  const issuerUrl = trimTrailingSlashes(settings.oidcIssuerUrl);
  return {
    issuerUrl,
    clientId: settings.oidcClientId.trim(),
    clientSecret: settings.oidcClientSecret.trim(),
    scopes: normalizeScopes(settings.oidcScopes),
    loginLabel: (settings.oidcLoginLabel || DEFAULT_LOGIN_LABEL).trim() || DEFAULT_LOGIN_LABEL,
  };
}

export async function fetchOidcDiscovery(issuerUrl) {
  const discoveryUrl = `${trimTrailingSlashes(issuerUrl)}/.well-known/openid-configuration`;
  const res = await fetchWithTimeout(discoveryUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Failed to load OIDC discovery document from ${discoveryUrl}`);
  }
  return await res.json();
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createOidcState() {
  return crypto.randomBytes(16).toString("base64url");
}

export function createOidcNonce() {
  return crypto.randomBytes(16).toString("base64url");
}

export function buildOidcAuthorizationUrl({
  authorizationEndpoint,
  clientId,
  redirectUri,
  scopes = DEFAULT_SCOPES,
  state,
  nonce,
  codeChallenge,
}) {
  const url = new URL(authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", normalizeScopes(scopes));
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeOidcCode({
  tokenEndpoint,
  clientId,
  clientSecret,
  code,
  redirectUri,
  codeVerifier,
}) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const res = await fetchWithTimeout(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data?.error_description || data?.error || `OIDC token exchange failed (${res.status})`;
    throw new Error(message);
  }

  return data;
}

export async function probeOidcClientSecret({
  tokenEndpoint,
  clientId,
  clientSecret,
  redirectUri,
}) {
  if (!clientSecret) {
    return {
      tested: false,
      valid: null,
      message: "No client secret was provided, so secret validation was skipped.",
    };
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    code: "__oidc_test_invalid_code__",
    redirect_uri: redirectUri,
    code_verifier: "__oidc_test_invalid_verifier__",
  });

  const res = await fetchWithTimeout(tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const data = await res.json().catch(() => ({}));
  const error = (data?.error || "").toLowerCase();
  const errorDescription = data?.error_description || data?.error || "";

  if (res.ok) {
    return {
      tested: true,
      valid: true,
      message: "Client secret was accepted by the token endpoint.",
      raw: data,
    };
  }

  if (error === "invalid_client" || error === "unauthorized_client" || /client.*(invalid|failed|mismatch)/i.test(errorDescription)) {
    return {
      tested: true,
      valid: false,
      message: errorDescription || "Client secret is not valid.",
      raw: data,
    };
  }

  if (error === "invalid_grant" || error === "invalid_code" || /grant|code/i.test(errorDescription)) {
    return {
      tested: true,
      valid: true,
      message: "Client secret was accepted; the token exchange failed only because the test authorization code is invalid.",
      raw: data,
    };
  }

  return {
    tested: true,
    valid: null,
    message: errorDescription || `Token endpoint responded with ${res.status}`,
    raw: data,
  };
}

export async function verifyOidcIdToken({
  idToken,
  issuer,
  audience,
  jwksUri,
  nonce,
}) {
  const jwks = createRemoteJWKSet(new URL(jwksUri), {
    timeoutDuration: OIDC_FETCH_TIMEOUT_MS,
  });
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer,
    audience,
    nonce,
  });
  return payload;
}

export function pickOidcDisplayName(payload = {}) {
  return payload.preferred_username || payload.email || payload.name || payload.given_name || payload.sub || "OIDC user";
}

export function pickOidcEmail(payload = {}) {
  return payload.email || "";
}
