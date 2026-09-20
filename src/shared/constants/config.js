import pkg from "../../../package.json" with { type: "json" };

export const APP_CONFIG = {
  name: "Sway Router",
  description: "AI Infrastructure Management",
  version: pkg.version,
};

export const RUNTIME_CONFIG = {
  appPort: Number.parseInt(process.env.PORT || "1212", 10) || 1212,
};

export const THEME_CONFIG = {
  storageKey: "theme",
  defaultTheme: "system",
};

export const SUBSCRIPTION_CONFIG = {
  price: 1.0,
  currency: "USD",
  interval: "month",
  planName: "Pro Plan",
};

export const API_ENDPOINTS = {
  users: "/api/users",
  providers: "/api/providers",
  payments: "/api/payments",
  auth: "/api/auth",
};

export const CONSOLE_LOG_CONFIG = {
  maxLines: 200,
  pollIntervalMs: 1000,
};

export const CLIENT_STORE_TTL_MS = 60000;

export const QUOTA_AUTOPING_CONFIG = {
  tickIntervalMs: 60000,
  pingLeadMs: 5000,
  refreshAheadMs: 300000,
  failureCooldownMs: 900000,
  providers: {
    claude: {
      settingsKey: "claudeAutoPing",
      quotaKey: "session (5h)",
      pingModel: "claude-haiku-4-5-20251001",
      pingText: "hi",
      pingMaxTokens: 1,
    },
    codex: {
      settingsKey: "codexAutoPing",
      quotaKey: "session",
      pingWhenResetAtSlides: true,
      resetAtDriftMs: 30000,
      minPingIntervalMs: 600000,
      skipWhenBlockingQuotaExhausted: true,

      pingModel: "gpt-5.5",
      pingText: "hi",
      pingInstructions: "Reply with OK.",
      pingReasoningEffort: "none",
    },
  },
};

export {
  AI_PROVIDERS,
  APIKEY_PROVIDERS,
  AUTH_METHODS,
  NO_AUTH_PROVIDERS,
  OAUTH_PROVIDERS,
  WEB_COOKIE_PROVIDERS,
} from "./providers.js";

export { AI_MODELS, PROVIDER_MODELS } from "./models.js";
