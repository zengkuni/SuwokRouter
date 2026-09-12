import type { LucideIcon } from "lucide-react";
import type { AvailableProvider } from "@/lib/connections-api";
import { BUILTIN_PROVIDER_CATALOG } from "@/lib/provider-catalog";
import {
  AppWindow,
  Binary,
  Bot,
  Boxes,
  Brain,
  Cloud,
  CloudCog,
  Code2,
  Combine,
  Cpu,
  Feather,
  Flame,
  FolderGit,
  Gem,
  Globe2,
  HardDrive,
  Landmark,
  MessageSquare,
  MessageSquareText,
  Microchip,
  Milestone,
  Radar,
  Rocket,
  Route,
  Satellite,
  Search,
  Shapes,
  Shield,
  Sparkles,
  Terminal,
  TriangleAlert,
  Waypoints,
  Waves,
  Wind,
  X,
  Zap,
} from "lucide-react";

export type AuthFlow =
  | "apikey"
  | "oauth"
  | "device"
  | "import"
  | "local";

type BackendFlow = "device_code" | "authorization_code" | "authorization_code_pkce" | "import_token" | "browser_token";
const OAUTH_FLOW_TYPE: Record<string, BackendFlow> = {
  antigravity: "authorization_code",
  claude: "authorization_code_pkce",
  cline: "authorization_code",
  clinepass: "authorization_code",
  "codebuddy-cn": "device_code",
  "codebuddy-intl": "device_code",
  "codebuddy-int": "device_code",
  codex: "authorization_code_pkce",
  cursor: "import_token",
  "gemini-cli": "authorization_code",
  github: "device_code",
  "grok-cli": "device_code",
  kilocode: "device_code",
  kimchi: "browser_token",
  kimi: "device_code",
  kiro: "device_code",
  qoder: "device_code",
  trae: "authorization_code",
  windsurf: "authorization_code",
  xai: "authorization_code_pkce",
};

const IMPORT_FLOW_PROVIDERS = new Set(["cursor"]);
const PROVIDER_FLOW_ALIASES: Record<string, string> = {
  "grok-build": "grok-cli",
  gb: "grok-cli",
};

export function resolveAuthFlow(
  providerId: string,
  authType?: string,
  noAuth?: boolean
): AuthFlow {
  if (noAuth || providerId === "ollama-local") return "local";
  const canonicalId = PROVIDER_FLOW_ALIASES[providerId] ?? providerId;
  const flow = OAUTH_FLOW_TYPE[canonicalId];
  if (flow === "import_token" || IMPORT_FLOW_PROVIDERS.has(canonicalId))
    return "import";
  if (flow === "device_code") return "device";
  if (flow === "authorization_code" || flow === "authorization_code_pkce" || flow === "browser_token")
    return "oauth";
  const a = (authType || "").toLowerCase();
  if (a.includes("import")) return "import";
  if (a.includes("device")) return "device";
  if (a.includes("oauth")) return "oauth";
  return "apikey";
}

export function connectionActionLabel(
  providerId: string,
  authType?: string,
  noAuth?: boolean,
  short = false
): string {
  const flow = resolveAuthFlow(providerId, authType, noAuth);
  if (flow === "apikey") return short ? "Add" : "Add connection";
  return short ? "Connect" : "Connect";
}

export function authTypeLabel(
  authType?: string,
  noAuth?: boolean
): string {
  if (noAuth) return "Local";
  const a = (authType || "apikey").toLowerCase();
  if (a.includes("import")) return "Import";
  if (a.includes("device")) return "Device";
  if (a.includes("oauth")) return "OAuth";
  if (a === "local") return "Local";
  if (a === "none") return "No auth";
  if (a === "cookie") return "Cookie";
  return "API key";
}

function authModeWord(mode: string): string {
  const m = (mode || "").toLowerCase();
  if (m.includes("oauth")) return "OAuth";
  if (m.includes("device")) return "Device";
  if (m.includes("import")) return "Import";
  if (m === "local") return "Local";
  if (m === "none") return "No auth";
  if (m === "cookie") return "Cookie";
  return "API key";
}

export function authModeLabels(
  authType?: string,
  noAuth?: boolean,
  authModes?: string[]
): string[] {
  if (noAuth) return ["Local"];
  const modes = Array.isArray(authModes) && authModes.length
    ? authModes
    : [authType || "apikey"];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of modes) {
    const word = authModeWord(m);
    if (!seen.has(word)) {
      seen.add(word);
      out.push(word);
    }
  }
  return out;
}

const ICON_MAP: Record<string, LucideIcon> = {

  openai: Sparkles,
  agentrouter: Route,
  claude: MessageSquare,
  deepseek: Brain,
  groq: Zap,
  openrouter: Globe2,
  kimi: MessageSquareText,
  glm: Binary,
  minimax: Microchip,
  kiro: Waypoints,
  codex: Code2,
  github: FolderGit,
  cursor: Cpu,
  "gemini-cli": Cloud,
  "grok-cli": Sparkles,
  "ollama-local": Boxes,
  antigravity: Rocket,
  qwen: Brain,
  "codebuddy-cn": Code2,
  qoder: Sparkles,

  alicode: Boxes,
  "alicode-intl": Boxes,
  "alims-intl": Boxes,
  anthropic: Brain,
  azure: Cloud,
  baidu: Search,
  blackbox: Boxes,
  byteplus: Cloud,
  cerebras: Microchip,
  chutes: Wind,
  cline: Terminal,
  clinepass: Shield,
  "cloudflare-ai": CloudCog,
  "codebuddy-intl": Code2,
  commandcode: Terminal,
  featherless: Feather,
  fireworks: Flame,
  gemini: Gem,
  "glm-cn": Binary,
  "grok-web": Radar,
  "kilo-gateway": Route,
  kilocode: Code2,
  kimchi: Flame,
  "minimax-cn": Microchip,
  mistral: Wind,
  morph: Shapes,
  meta: Sparkles,
  nebius: Cloud,
  nvidia: HardDrive,
  ollama: Boxes,
  opencode: Terminal,
  "opencode-go": Terminal,
  perplexity: Search,
  poolside: Waves,
  sumopod: Cloud,
  tencent: Cloud,
  together: Combine,
  trae: AppWindow,
  venice: Landmark,
  "vercel-ai-gateway": TriangleAlert,
  vertex: Satellite,
  "vertex-partner": Satellite,
  windsurf: Waves,
  xai: X,
  "xiaomi-mimo": Milestone,
  "xiaomi-tokenplan": Milestone,
};

export function providerIcon(id: string): LucideIcon {
  const canonical = resolveProviderId(id);
  return ICON_MAP[id] || ICON_MAP[canonical] || Bot;
}

export function providerColor(id: string, fallback?: string): string {
  if (fallback) return fallback;
  const canonical = resolveProviderId(id);
  const map: Record<string, string> = {
    openai: "#10a37f",
    agentrouter: "#7c5cfc",
    claude: "#d97757",
    deepseek: "#4d6bfe",
    groq: "#f55036",
    openrouter: "#6566f1",
    sumopod: "#f4f4f5",
    meta: "#0668e1",
    kiro: "#22c55e",
    github: "#ffffff",
    cursor: "#88c0d0",
    "gemini-cli": "#4285f4",
    "ollama-local": "#ffffff",
  };
  return map[id] || map[canonical] || "#fafafa";
}

const PROVIDER_NAMES: Record<string, string> = {
  openai: "OpenAI",
  claude: "Claude",
  deepseek: "DeepSeek",
  groq: "Groq",
  openrouter: "OpenRouter",
  sumopod: "SumoPod",
  meta: "Meta AI",
  kiro: "Kiro",
  github: "GitHub Copilot",
  cursor: "Cursor",
  "gemini-cli": "Gemini CLI",
  "ollama-local": "Ollama",
  antigravity: "Antigravity",
  ag: "Antigravity",
  "codebuddy-cn": "CodeBuddy CN",
  "codebuddy-int": "CodeBuddy INT",
  cbi: "CodeBuddy INT",
  cbcn: "CodeBuddy CN",
  codex: "Codex",
  cx: "Codex",
  "grok-cli": "Grok CLI",
  gcli: "Grok CLI",
  kimi: "Kimi",
  qoder: "Qoder",
  qd: "Qoder",
  glm: "GLM",
  minimax: "MiniMax",
  xiaomi: "Xiaomi",
  "xiaomi-mimo": "Xiaomi MiMo",
  fireworks: "Fireworks",
  "cloudflare-ai": "Cloudflare AI",
  cfai: "Cloudflare AI",
  qwen: "Qwen",
  "openai-compatible-chat-demo01": "My Custom LLM",
};

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const p of BUILTIN_PROVIDER_CATALOG) {
    if (p.id) map[p.id] = p.id;
    if (p.alias && p.alias !== p.id) map[p.alias] = p.id;
  }

  Object.assign(map, {
    gcli: "grok-cli",
    gw: "grok-web",
    cx: "codex",
    cc: "claude",
    ag: "antigravity",
    cbcn: "codebuddy-cn",
    cbai: "codebuddy-intl",
    ds: "deepseek",
    gc: "gemini-cli",
    gh: "github",
    kr: "kiro",
    mimo: "xiaomi-mimo",
    ocg: "opencode-go",
  });
  return map;
})();

export function resolveProviderId(id: string): string {
  if (!id) return id;
  const normalized = id.trim().toLowerCase();
  return ALIAS_TO_CANONICAL[id] || ALIAS_TO_CANONICAL[normalized] || id;
}

export function providerName(id: string): string {
  const canonical = resolveProviderId(id);
  return (
    BUILTIN_PROVIDER_CATALOG.find((p) => p.id === canonical)?.name ||
    PROVIDER_NAMES[id] ||
    PROVIDER_NAMES[canonical] ||
    canonical
  );
}

const AUTH_TYPE_MAP: Record<string, string> = {
  openai: "apikey",
  claude: "oauth",
  codex: "oauth",
  cursor: "import",
  deepseek: "apikey",
  groq: "apikey",
  openrouter: "apikey",
  sumopod: "apikey",
  kimi: "oauth",
  glm: "apikey",
  minimax: "apikey",
  kiro: "apikey",
  github: "oauth",
  "gemini-cli": "oauth",
  "grok-cli": "device",
  antigravity: "oauth",
  "codebuddy-cn": "oauth",
  "codebuddy-int": "oauth",
  qoder: "oauth",
  "ollama-local": "local",
  xai: "oauth",
  "grok-web": "cookie",
  "xiaomi-mimo": "apikey",
  mimo: "apikey",
  kilocode: "oauth",
  kimchi: "oauth",
  trae: "oauth",
  windsurf: "oauth",
};

const ALIAS_MAP: Record<string, string> = {
  claude: "cc",
  codex: "cx",
  cursor: "cu",
  kiro: "kr",
  github: "gh",
  "gemini-cli": "gc",
  "grok-cli": "gcli",
  antigravity: "ag",
  "codebuddy-cn": "cbcn",
  "codebuddy-int": "cbi",
  qoder: "qd",
};

export function getProviderDisplay(id: string): {
  name?: string;
  alias?: string;
  authType?: string;
  color?: string;
  icon?: string;
  textIcon?: string;
  category?: string;
  noAuth?: boolean;
  hasOAuth?: boolean;
  authModes?: string[];
} | null {
  if (id === "ollama-local") {
    return {
      name: "Ollama Local",
      alias: "ollama-local",
      authType: "local",
      color: "#ffffff",
      icon: "Boxes",
      noAuth: true,
    };
  }

  const canonical = resolveProviderId(id);
  const entry = BUILTIN_PROVIDER_CATALOG.find((p) => p.id === canonical);
  if (entry) {
    return {
      name: entry.name,
      alias: entry.alias,
      authType: entry.authType,
      color: entry.color,
      icon: entry.icon,
      textIcon: entry.textIcon,
      category: entry.category,
      noAuth: entry.noAuth,
      hasOAuth: entry.hasOAuth,
      authModes: entry.authModes,
    };
  }
  const name = PROVIDER_NAMES[id];
  if (!name && !AUTH_TYPE_MAP[id] && !ALIAS_MAP[id]) return null;
  return {
    name: name || id,
    alias: ALIAS_MAP[id] || id,
    authType: AUTH_TYPE_MAP[id] || "apikey",
    color: providerColor(id),
  };
}

export function getBuiltinProviders(): AvailableProvider[] {
  return BUILTIN_PROVIDER_CATALOG.map((p) => ({
    ...p,
    ...getProviderDisplay(p.id),
  }));
}
