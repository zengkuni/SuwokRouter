import { platform, arch } from "os";

export function mapStainlessOs() {
  switch (platform()) {
    case "darwin": return "MacOS";
    case "win32": return "Windows";
    case "linux": return "Linux";
    case "freebsd": return "FreeBSD";
    default: return `Other::${platform()}`;
  }
}

export function mapStainlessArch() {
  switch (arch()) {
    case "x64": return "x64";
    case "arm64": return "arm64";
    case "ia32": return "x86";
    default: return `other::${arch()}`;
  }
}

export const ANTHROPIC_API_VERSION = "2023-06-01";

export const CLAUDE_API_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,interleaved-thinking-2025-05-14"
};

export const CLAUDE_CLI_SPOOF_HEADERS = {
  "Anthropic-Version": ANTHROPIC_API_VERSION,
  "Anthropic-Beta": "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14,context-management-2025-06-27,prompt-caching-scope-2026-01-05,advanced-tool-use-2025-11-20,effort-2025-11-24,structured-outputs-2025-12-15,fast-mode-2026-02-01,redact-thinking-2026-02-12,token-efficient-tools-2026-03-28",
  "Anthropic-Dangerous-Direct-Browser-Access": "true",
  "User-Agent": "claude-cli/2.1.92 (external, sdk-cli)",
  "X-App": "cli",
  "X-Stainless-Helper-Method": "stream",
  "X-Stainless-Retry-Count": "0",
  "X-Stainless-Runtime-Version": "v24.14.0",
  "X-Stainless-Package-Version": "0.80.0",
  "X-Stainless-Runtime": "node",
  "X-Stainless-Lang": "js",
  "X-Stainless-Arch": mapStainlessArch(),
  "X-Stainless-Os": mapStainlessOs(),
  "X-Stainless-Timeout": "600"
};

const ANTHROPIC_BETA_BASE = [
  "claude-code-20250219",
  "oauth-2025-04-20", // gitleaks:allow -- public Anthropic feature flag
  "interleaved-thinking-2025-05-14",
  "context-management-2025-06-27",
  "prompt-caching-scope-2026-01-05",
  "structured-outputs-2025-12-15",
  "fast-mode-2026-02-01",
  "redact-thinking-2026-02-12",
  "token-efficient-tools-2026-03-28",
];
const ANTHROPIC_BETA_HEAVY_AGENT = ["advanced-tool-use-2025-11-20", "effort-2025-11-24"];

export function selectAnthropicBeta(model = "") {
  const flags = [...ANTHROPIC_BETA_BASE];
  if (/^claude-(opus|sonnet)/.test(model)) flags.push(...ANTHROPIC_BETA_HEAVY_AGENT);
  return flags.join(",");
}

export const KIMI_CODING_BASE_URL = "https://api.kimi.com/coding/v1/messages";

export const OPENAI_COMPAT_BASE = "https://api.openai.com/v1";
export const ANTHROPIC_COMPAT_BASE = "https://api.anthropic.com/v1";

// AgentRouter validates compatible clients by their client fingerprint. Keep
// these headers scoped to the built-in provider instead of exposing them as a
// user-configurable custom-provider option.
export const AGENTROUTER_MODELS_URL = "https://agentrouter.org/v1/models";
export const AGENTROUTER_OPENAI_HEADERS = {
  "User-Agent": "codex_cli_rs/0.149.1",
  originator: "codex_cli_rs",
  version: "0.149.1",
};
export const AGENTROUTER_ANTHROPIC_HEADERS = {
  "User-Agent": "claude-cli/1.0.0 (external, cli)",
};
export const AGENTROUTER_ANTHROPIC_AUTH = {
  combined: true,
  header: "Authorization",
  scheme: "bearer",
  additional: [{ header: "x-api-key", scheme: "raw" }],
  anthropicVersion: true,
};

export const ANTIGRAVITY_IDE_VERSION = "2.1.1";
export const ANTIGRAVITY_IDE_BASE_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_IDE_USER_AGENT = `antigravity/ide/${ANTIGRAVITY_IDE_VERSION} darwin/arm64`;

function getOAuthClient(clientIdEnv, clientSecretEnv) {
  return {
    clientId: process.env[clientIdEnv]?.trim() || "",
    clientSecret: process.env[clientSecretEnv]?.trim() || "",
  };
}

export const ANTIGRAVITY_OAUTH_CLIENT = {
  // Public application credentials distributed with the Antigravity desktop
  // OAuth integration. Environment variables can override either value.
  clientId:
    process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() ||
    "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
  clientSecret:
    process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() ||
    "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", // gitleaks:allow -- public desktop OAuth application credential
};

export const GOOGLE_OAUTH_CLIENT = {
  ...getOAuthClient("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"),
};
