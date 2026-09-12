export type ProviderStatus = "online" | "offline" | "degraded";

export type ProviderType =
  | "alicode" | "alicode-intl" | "alims-intl" | "anthropic" | "antigravity"
  | "azure" | "baidu" | "blackbox" | "byteplus" | "cerebras"
  | "chutes" | "claude" | "cline" | "clinepass" | "cloudflare-ai"
  | "codebuddy-cn" | "codebuddy-intl" | "codex" | "commandcode" | "cursor"
  | "deepseek" | "featherless" | "fireworks" | "gemini" | "gemini-cli"
  | "github" | "glm" | "glm-cn" | "grok-cli" | "grok-web"
  | "groq" | "kilo-gateway" | "kilocode" | "kimchi" | "kimi"
  | "kiro" | "minimax" | "minimax-cn" | "mistral"
  | "morph" | "nebius" | "nvidia" | "ollama" | "ollama-local"
  | "openai" | "opencode" | "opencode-go" | "openrouter" | "perplexity"
  | "poolside" | "qoder" | "tencent"
  | "together" | "trae" | "venice" | "vercel-ai-gateway"
  | "sumopod" | "vertex" | "vertex-partner" | "windsurf" | "xai" | "xiaomi-mimo"
  | "xiaomi-tokenplan";

export type ProviderCategory = "apikey" | "oauth" | "webCookie" | "none";
export type AuthType = "apikey" | "oauth" | "cookie" | "none";

export type ProviderFormat =
  | "openai" | "claude" | "gemini" | "ollama" | "vertex"
  | "cursor" | "commandcode" | "antigravity" | "kiro"
  | "grok-web" | "gemini-cli"
  | "custom";

export type ProviderService = "llm" | "search" | "embeddings" | "image" | "audio";

export interface OAuthConfig {
  clientId?: string;
  clientSecret?: string;
  authUrl?: string;
  tokenUrl?: string;
  scopes?: string[];
  [key: string]: unknown;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  category: ProviderCategory;
  authType: AuthType;
  authModes: AuthType[];
  format: ProviderFormat;
  service: ProviderService;
  baseUrl: string;
  apiKey?: string;
  oauthConfig?: OAuthConfig;
  models: string[];
  status: ProviderStatus;
  priority: number;
  weight: number;
  maxTokens: number;
  rateLimit: number;
  createdAt: string;
  updatedAt: string;
}
