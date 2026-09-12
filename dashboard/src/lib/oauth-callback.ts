export const OAUTH_CALLBACK_SOURCE = "sway-oauth";
export const OAUTH_CALLBACK_TYPE = "oauth_callback";
const OAUTH_CALLBACK_STORAGE_PREFIX = "sway-oauth-callback:";
const OAUTH_CALLBACK_PROVIDER_PREFIX = "sway-oauth-provider:";
const OAUTH_CALLBACK_MAX_AGE_MS = 10 * 60 * 1000;

export type OAuthCallbackPayload = {
  code?: string;
  state?: string;
  provider?: string;
  error?: string;
  errorDescription?: string;
};

export type ParsedOAuthCallbackInput = {
  code: string;
  state?: string;
};

type OAuthCallbackMessage = {
  source?: unknown;
  type?: unknown;
  data?: unknown;
  code?: unknown;
  state?: unknown;
  provider?: unknown;
  error?: unknown;
  error_description?: unknown;
  errorDescription?: unknown;
};

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function payloadFromObject(value: unknown): OAuthCallbackPayload {
  if (!value || typeof value !== "object") return {};
  const data = value as OAuthCallbackMessage;
  return {
    code: stringValue(data.code),
    state: stringValue(data.state),
    provider: stringValue(data.provider),
    error: stringValue(data.error),
    errorDescription: stringValue(data.errorDescription ?? data.error_description),
  };
}

function storageKey(state: string): string {
  return `${OAUTH_CALLBACK_STORAGE_PREFIX}${encodeURIComponent(state)}`;
}

function providerStorageKey(state: string): string {
  return `${OAUTH_CALLBACK_PROVIDER_PREFIX}${encodeURIComponent(state)}`;
}

export function storeOAuthCallbackProvider(state: string, provider: string): void {
  if (!state.trim() || !provider.trim()) return;
  try {
    window.localStorage.setItem(
      providerStorageKey(state),
      JSON.stringify({ provider: provider.trim(), storedAt: Date.now() }),
    );
  } catch {

  }
}

export function readOAuthCallbackProvider(state: string): string | undefined {
  if (!state.trim()) return undefined;
  try {
    const raw = window.localStorage.getItem(providerStorageKey(state));
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as { provider?: unknown; storedAt?: unknown };
    if (
      typeof stored.storedAt !== "number" ||
      Date.now() - stored.storedAt > OAUTH_CALLBACK_MAX_AGE_MS ||
      Date.now() - stored.storedAt < -OAUTH_CALLBACK_MAX_AGE_MS
    ) {
      return undefined;
    }
    return stringValue(stored.provider);
  } catch {
    return undefined;
  }
}

export function clearOAuthCallbackProvider(state: string): void {
  if (!state.trim()) return;
  try {
    window.localStorage.removeItem(providerStorageKey(state));
  } catch {

  }
}

export function storeOAuthCallback(payload: OAuthCallbackPayload): boolean {
  if (!payload.state || !(payload.code || payload.error)) return false;
  try {
    window.localStorage.setItem(
      storageKey(payload.state),
      JSON.stringify({ payload, storedAt: Date.now() }),
    );
    return true;
  } catch {
    return false;
  }
}

export function parseOAuthCallbackStorageValue(
  value: string | null,
  nowMs = Date.now(),
): OAuthCallbackPayload | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as { payload?: unknown; storedAt?: unknown };
    if (
      typeof stored.storedAt !== "number" ||
      nowMs - stored.storedAt > OAUTH_CALLBACK_MAX_AGE_MS ||
      nowMs - stored.storedAt < -OAUTH_CALLBACK_MAX_AGE_MS
    ) {
      return null;
    }
    const payload = payloadFromObject(stored.payload);
    return payload.state && (payload.code || payload.error) ? payload : null;
  } catch {
    return null;
  }
}

export function readOAuthCallback(state: string): OAuthCallbackPayload | null {
  try {
    return parseOAuthCallbackStorageValue(window.localStorage.getItem(storageKey(state)));
  } catch {
    return null;
  }
}

export function clearOAuthCallback(state: string): void {
  try {
    window.localStorage.removeItem(storageKey(state));
  } catch {

  }
}

export function getOAuthCallbackStorageKey(state: string): string {
  return storageKey(state);
}

export function parseOAuthCallbackSearch(search: string): OAuthCallbackPayload {
  const params = new URLSearchParams(search);
  const error = stringValue(params.get("error"));
  const provider = stringValue(params.get("provider"));
  return {
    code: stringValue(params.get("code")),
    state: stringValue(params.get("state")),
    ...(provider ? { provider } : {}),
    error,
    errorDescription: stringValue(params.get("error_description")),
  };
}

export function parseOAuthCallbackInput(
  value: string,
  expectedState?: string | null,
): ParsedOAuthCallbackInput {
  const input = value.trim();
  if (!input) throw new Error("Paste the authorization code or callback URL");

  let callbackUrl: URL | null = null;
  try {
    callbackUrl = new URL(input);
  } catch {
    return {
      code: input,
      ...(expectedState ? { state: expectedState } : {}),
    };
  }

  if (callbackUrl.protocol !== "http:" && callbackUrl.protocol !== "https:") {
    throw new Error("The callback URL must use HTTP or HTTPS");
  }

  const payload = parseOAuthCallbackSearch(callbackUrl.search);
  if (payload.error) {
    throw new Error(payload.errorDescription || payload.error);
  }
  if (!payload.code) {
    throw new Error("The callback URL does not contain an authorization code");
  }
  if (!payload.state) {
    throw new Error("The callback URL does not contain the OAuth state");
  }
  if (expectedState && payload.state !== expectedState) {
    throw new Error("The callback URL belongs to a different OAuth session. Start again and use the newest callback.");
  }

  return { code: payload.code, state: payload.state };
}

export function getOAuthCallbackTargetOrigins(callbackOrigin: string): string[] {
  try {
    const url = new URL(callbackOrigin);
    const origins = [url.origin];
    if (url.protocol !== "http:") return origins;

    const alias = new URL(url.origin);
    if (url.hostname === "localhost") alias.hostname = "127.0.0.1";
    else if (url.hostname === "127.0.0.1") alias.hostname = "localhost";
    else return origins;

    if (!origins.includes(alias.origin)) origins.push(alias.origin);
    return origins;
  } catch {
    return [];
  }
}

export function createOAuthCallbackMessage(payload: OAuthCallbackPayload) {
  return {
    source: OAUTH_CALLBACK_SOURCE,
    type: OAUTH_CALLBACK_TYPE,
    ...payload,
    data: payload,
  };
}

export function parseOAuthCallbackMessage(value: unknown): OAuthCallbackPayload | null {
  if (!value || typeof value !== "object") return null;
  const message = value as OAuthCallbackMessage;
  if (message.source !== OAUTH_CALLBACK_SOURCE) return null;
  if (message.type !== undefined && message.type !== OAUTH_CALLBACK_TYPE) return null;

  const topLevel = payloadFromObject(message);
  const nested = payloadFromObject(message.data);
  const payload: OAuthCallbackPayload = {
    code: topLevel.code || nested.code,
    state: topLevel.state || nested.state,
    provider: topLevel.provider || nested.provider,
    error: topLevel.error || nested.error,
    errorDescription: topLevel.errorDescription || nested.errorDescription,
  };
  return payload.code || payload.error ? payload : null;
}

export function validateOAuthCallbackMessage(
  value: unknown,
  options: {
    origin: string;
    eventOrigin: string;
    expectedState: string | null | undefined;
    expectedProvider?: string;
    eventSource?: unknown;
    expectedSource?: unknown;
  },
): OAuthCallbackPayload | null {
  if (options.eventOrigin !== options.origin) return null;
  if (options.expectedSource && options.eventSource !== options.expectedSource) return null;

  const payload = parseOAuthCallbackMessage(value);
  if (!payload || !options.expectedState || payload.state !== options.expectedState) {
    return null;
  }
  if (payload.provider && options.expectedProvider && payload.provider !== options.expectedProvider) {
    return null;
  }
  return payload;
}
