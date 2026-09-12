const MICROSOFT_TOKEN_ENDPOINT_HOSTS = new Set([
  "login.microsoftonline.com",
  "login.microsoft.com",
  "login.windows.net",
]);

const DEFAULT_REGION = "us-east-1";
const DEFAULT_EXPIRES_IN = 3600;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstInputValue(input, ...keys) {
  for (const key of keys) {
    if (input[key]) return input[key];
  }
  return undefined;
}

export function validateMicrosoftTokenEndpoint(rawEndpoint) {
  const tokenEndpoint = normalizeString(rawEndpoint);
  if (!tokenEndpoint) throw new Error("token_endpoint is required");

  let parsed;
  try {
    parsed = new URL(tokenEndpoint);
  } catch {
    throw new Error("token_endpoint must be a valid URL");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("token_endpoint must use https");
  }

  const host = parsed.hostname.toLowerCase();
  if (!MICROSOFT_TOKEN_ENDPOINT_HOSTS.has(host)) {
    throw new Error("token_endpoint must be a Microsoft login endpoint");
  }

  return parsed.toString();
}

export function normalizeScope(scopes) {
  if (Array.isArray(scopes)) {
    return scopes.map(normalizeString).filter(Boolean).join(" ");
  }
  return normalizeString(scopes);
}

export function decodeJwtPayload(jwt) {
  try {
    if (!jwt || typeof jwt !== "string") return null;
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padding = (4 - (base64.length % 4)) % 4;
    return JSON.parse(Buffer.from(`${base64}${"=".repeat(padding)}`, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function resolveExpiresAt(input) {
  const explicit = firstInputValue(input, "expired", "expires_at", "expiresAt");
  if (explicit) {
    const ms = new Date(explicit).getTime();
    if (Number.isFinite(ms)) return new Date(ms).toISOString();
  }

  const expiresIn = Number(firstInputValue(input, "expires_in", "expiresIn") || 0);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(Date.now() + expiresIn * 1000).toISOString();
  }

  const payload = decodeJwtPayload(firstInputValue(input, "access_token", "accessToken"));
  if (payload?.exp) {
    return new Date(payload.exp * 1000).toISOString();
  }

  return new Date(Date.now() + DEFAULT_EXPIRES_IN * 1000).toISOString();
}

export function normalizeKiroExternalIdpAuth(rawAuth) {
  let input = rawAuth;
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new Error("CLIProxyAPI auth JSON is invalid");
    }
  }

  if (!input || typeof input !== "object") {
    throw new Error("CLIProxyAPI auth JSON is required");
  }

  const authMethod = normalizeString(firstInputValue(input, "auth_method", "authMethod"));
  if (authMethod && authMethod !== "external_idp") {
    throw new Error("Only external_idp Kiro auth is supported by this importer");
  }

  const accessToken = normalizeString(firstInputValue(input, "access_token", "accessToken"));
  const refreshToken = normalizeString(firstInputValue(input, "refresh_token", "refreshToken"));
  const clientId = normalizeString(firstInputValue(input, "client_id", "clientId"));
  const tokenEndpoint = validateMicrosoftTokenEndpoint(firstInputValue(input, "token_endpoint", "tokenEndpoint"));
  const profileArn = normalizeString(firstInputValue(input, "profile_arn", "profileArn"));
  const region = normalizeString(input.region) || DEFAULT_REGION;
  const scope = normalizeScope(firstInputValue(input, "scopes", "scope"));

  if (!accessToken) throw new Error("access_token is required");
  if (!refreshToken) throw new Error("refresh_token is required");
  if (!clientId) throw new Error("client_id is required");
  if (!scope) throw new Error("scopes is required");
  if (!profileArn) throw new Error("profile_arn is required");

  const payload = decodeJwtPayload(accessToken);
  const email = firstInputValue(input, "email")
    || payload?.email
    || payload?.preferred_username
    || payload?.upn
    || payload?.sub
    || null;

  return {
    accessToken,
    refreshToken,
    expiresAt: resolveExpiresAt(input),
    email,
    providerSpecificData: {
      profileArn,
      region,
      authMethod: "external_idp",
      provider: "CLIProxyAPI",
      clientId,
      tokenEndpoint,
      scope,
    },
  };
}

export function buildExternalIdpRefreshParams(refreshToken, providerSpecificData = {}) {
  const clientId = normalizeString(firstInputValue(providerSpecificData, "clientId", "client_id"));
  const tokenEndpoint = validateMicrosoftTokenEndpoint(firstInputValue(providerSpecificData, "tokenEndpoint", "token_endpoint"));
  const scope = normalizeScope(firstInputValue(providerSpecificData, "scope", "scopes"));

  if (!refreshToken) throw new Error("refresh token is required");
  if (!clientId) throw new Error("clientId is required for external_idp refresh");
  if (!scope) throw new Error("scope is required for external_idp refresh");

  return {
    tokenEndpoint,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: clientId,
      refresh_token: refreshToken,
      scope,
    }),
    providerSpecificData: {
      ...providerSpecificData,
      authMethod: "external_idp",
      clientId,
      tokenEndpoint,
      scope,
    },
  };
}
