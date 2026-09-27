import {
  GROK_SESSION_API,
  GROK_SSO_INVALID_MESSAGE as GROK_INVALID_MESSAGE,
  GROK_USER_AGENT,
} from "./grokSsoProbe.js";

const REQUEST_TIMEOUT_MS = 12_000;

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(values) {
  for (const value of values) {
    const normalized = asString(value);
    if (normalized) return normalized;
  }
  return "";
}

/** Accepts `sso=<token>`, a bare token, or a whole cookie header. */
export function sanitizeGrokSsoToken(value) {
  let token = asString(value);
  const assignment = token.indexOf("sso=");
  if (assignment >= 0) {
    token = token.slice(assignment + 4);
    const terminator = token.search(/[;\s]/);
    if (terminator >= 0) token = token.slice(0, terminator);
  }
  return token.replace(/[\r\n\x00]/g, "").trim();
}

function parseSessionIdentity(payload) {
  const root = asObject(payload);
  const session = asObject(root.session);
  const user = asObject(root.user);
  const status = asString(root.status);

  return {
    status,
    email: firstString([session.email, user.email, root.email]),
    userId: firstString([session.userId, session.id, user.id, user.userId, user.sub, root.userId, root.sub]),
  };
}

/**
 * Reads the Grok account behind an SSO cookie from the same endpoint the
 * official web client uses (`GET /api/auth/session`). Unlike the chat
 * endpoint, it is not behind the anti-bot check, so it answers reliably with
 * only the cookie. Never throws: callers treat an empty identity as
 * "unknown account" and fall back to a generated connection label.
 */
export async function fetchGrokSsoIdentity(ssoToken, options = {}) {
  const token = sanitizeGrokSsoToken(ssoToken);
  if (!token) return { email: "", userId: "", status: "missing-token" };

  try {
    const response = await fetch(GROK_SESSION_API, {
      method: "GET",
      headers: {
        Accept: "*/*",
        Cookie: `sso=${token}`,
        Origin: "https://grok.com",
        Referer: "https://grok.com/",
        "User-Agent": GROK_USER_AGENT,
      },
      signal: options?.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.status === 401) return { email: "", userId: "", status: "unauthorized" };
    if (response.status === 403) return { email: "", userId: "", status: "blocked" };
    if (!response.ok) return { email: "", userId: "", status: `http-${response.status}` };

    const identity = parseSessionIdentity(await response.json());
    if (identity.status.toLowerCase() === "unauthenticated") {
      return { email: "", userId: "", status: "unauthenticated" };
    }
    if (identity.status.toLowerCase() === "blocked") {
      return { email: "", userId: "", status: "blocked" };
    }
    return identity.email || identity.userId
      ? { ...identity, status: "authenticated" }
      : { ...identity, status: identity.status || "no-identity" };
  } catch {
    return { email: "", userId: "", status: "unreachable" };
  }
}

/**
 * Validity check for a pasted sso cookie. Returns `null` validity when Grok
 * could not be reached or refused the session read, so callers can tell the
 * user "unknown" instead of blaming the cookie.
 */
export async function validateGrokSsoCookie(ssoToken, options = {}) {
  const identity = await fetchGrokSsoIdentity(ssoToken, options);
  if (identity.status === "authenticated") {
    return { valid: true, error: null, email: identity.email };
  }
  if (identity.status === "unauthorized" || identity.status === "unauthenticated") {
    return { valid: false, error: GROK_INVALID_MESSAGE, email: "" };
  }
  if (identity.status === "missing-token") {
    return { valid: false, error: "An sso cookie value is required", email: "" };
  }
  return { valid: null, error: `Could not verify the SSO cookie (${identity.status}) — try again`, email: "" };
}
