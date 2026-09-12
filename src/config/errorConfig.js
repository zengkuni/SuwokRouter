export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
};

export const ERROR_TIERS = {
  T1: "T1",
  T2: "T2",
  T3: "T3",
};

const T1_BACKOFF_BASE = 30 * 1000;
const T1_BACKOFF_CAP = 5 * 60 * 1000;

const T3_DEPRIORITIZE_MS = 10 * 60 * 1000;

const JITTER_FRACTION = 0.25;

export const ERROR_RULES = [

  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.long },
  { status: 404, cooldownMs: COOLDOWN.long },
  { status: 429, backoff: true },
];

export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};

export function classifyError(status, errorText, retryCount = 0, opts = {}) {
  const lowerError = errorText
    ? (typeof errorText === "string" ? errorText : JSON.stringify(errorText)).toLowerCase()
    : "";
  const rng = typeof opts.rng === "function" ? opts.rng : null;

  const t1Texts = ["rate limit", "too many requests", "quota exceeded", "capacity", "overloaded"];
  if (t1Texts.some((t) => lowerError.includes(t)) || Number(status) === 429) {
    const exp = T1_BACKOFF_BASE * Math.pow(2, retryCount);
    const base = Math.min(exp, T1_BACKOFF_CAP);
    const jitter = rng ? Math.floor(rng() * base * JITTER_FRACTION) : 0;
    return { tier: ERROR_TIERS.T1, action: "cooldown", cooldownMs: base + jitter };
  }

  const t3Texts = ["no credentials", "request not allowed", "improperly formed request"];
  const t3ByText = t3Texts.some((t) => lowerError.includes(t));
  const t3ByStatus = [401, 402, 403, 404, 406].includes(Number(status));
  if (t3ByStatus || t3ByText) {
    const jitter = rng ? Math.floor(rng() * COOLDOWN.long * JITTER_FRACTION) : 0;
    return {
      tier: ERROR_TIERS.T3,
      action: "deprioritize",
      cooldownMs: COOLDOWN.long + jitter,
      deprioitizeUntil: Date.now() + COOLDOWN.long + jitter + T3_DEPRIORITIZE_MS,
    };
  }

  const jitter = rng ? Math.floor(rng() * COOLDOWN.short * JITTER_FRACTION) : 0;
  return { tier: ERROR_TIERS.T2, action: "retry-same", cooldownMs: COOLDOWN.short + jitter };
}

export function isDeprioitized(deprioitizeUntil) {
  if (!deprioitizeUntil) return false;
  return deprioitizeUntil > Date.now();
}
