import { decodeJwtPayload } from "../lib/oauth/providerHelpers.js";

const CODEBUDDY_ACCOUNT_CONFIG = {
  "codebuddy-cn": {
    baseUrl: "https://copilot.tencent.com",
    domain: "copilot.tencent.com",
  },
  "codebuddy-intl": {
    baseUrl: "https://www.codebuddy.ai",
    domain: "www.codebuddy.ai",
  },
};

const ACCOUNTS_PATH = "/v2/accounts";
const ACCOUNT_REQUEST_TIMEOUT_MS = 8000;
const CODEBUDDY_USER_AGENT = "CLI/2.108.1 CodeBuddy/2.108.1";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function asEmail(value) {
  const normalized = asString(value);
  return EMAIL_PATTERN.test(normalized) ? normalized : "";
}

export function isCodeBuddyAccountProvider(provider) {
  return Object.hasOwn(CODEBUDDY_ACCOUNT_CONFIG, asString(provider));
}

export function decodeCodeBuddyAccountToken(accessToken) {
  return asObject(decodeJwtPayload(asString(accessToken)));
}

function identityFromAccount(account) {
  return {
    email: firstString([
      asEmail(account.email),
      asEmail(account.mail),
      asEmail(account.username),
      asEmail(account.account),
    ]),
    name: firstString([
      account.nickname,
      account.name,
      account.displayName,
      account.username,
      account.realName,
      account.preferredUsername,
    ]),
  };
}

function identityFromToken(payload) {
  return {
    email: firstString([
      asEmail(payload.email),
      asEmail(payload.mail),
      asEmail(payload.preferred_username),
      asEmail(payload.username),
    ]),
    name: firstString([
      payload.nickname,
      payload.name,
      payload.displayName,
      payload.preferred_username,
    ]),
  };
}

function extractAccounts(payload) {
  const root = asObject(payload);
  const outer = asObject(root.data);
  const inner = asObject(outer.data);
  for (const candidate of [inner.accounts, outer.accounts, root.accounts]) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function selectAccount(accounts, userId) {
  const list = accounts.map(asObject).filter((account) => Object.keys(account).length > 0);
  if (list.length === 0) return null;
  const pluginEnabled = list.filter((account) => account.pluginEnabled !== false);
  const pool = pluginEnabled.length > 0 ? pluginEnabled : list;
  if (userId) {
    const matched = pool.find(
      (account) => firstString([account.uid, account.userId, account.id]) === userId,
    );
    if (matched) return matched;
  }
  return pool.find((account) => account.lastLogin === true) || pool[0];
}

async function fetchCodeBuddyAccounts(provider, accessToken, options) {
  const config = CODEBUDDY_ACCOUNT_CONFIG[provider];
  if (!config) return [];
  const response = await fetch(`${config.baseUrl}${ACCOUNTS_PATH}`, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": CODEBUDDY_USER_AGENT,
      "X-Requested-With": "XMLHttpRequest",
      "X-Product": "SaaS",
      "X-IDE-Name": "CLI",
      "X-IDE-Type": "CLI",
      "X-IDE-Version": "2.108.1",
      "X-Domain": config.domain,
    },
    signal: options?.signal || AbortSignal.timeout(ACCOUNT_REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  return extractAccounts(await response.json());
}

/**
 * Collects the connected CodeBuddy account from the real server API
 * (`GET /v2/accounts`, the endpoint the official CLI reads) and falls back to
 * the access-token claims when the account list is unavailable. The dashboard
 * label prefers the email, then the account name.
 */
export async function resolveCodeBuddyIdentity(provider, accessToken, options = {}) {
  const token = asString(accessToken);
  if (!token) return { email: "", name: "", source: "none" };

  const payload = decodeCodeBuddyAccountToken(token);
  const tokenIdentity = identityFromToken(payload);

  let accounts = [];
  try {
    accounts = await fetchCodeBuddyAccounts(provider, token, options);
  } catch {
    accounts = [];
  }

  const account = selectAccount(
    accounts,
    firstString([payload.sub, payload.userId, payload.user_id]),
  );
  const accountIdentity = account
    ? identityFromAccount(account)
    : { email: "", name: "" };

  const email = accountIdentity.email || tokenIdentity.email;
  const name = accountIdentity.name || tokenIdentity.name;
  const source = account ? "accounts" : email || name ? "token" : "none";

  return { email, name, source };
}
