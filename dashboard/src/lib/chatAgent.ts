export type AgentToolCall = {
  id: string;
  type?: string;
  function: { name: string; arguments: string };
};

export type AgentToolActivity = {
  id: string;
  name: string;
  label: string;
  status: "running" | "done" | "error" | "denied";
  detail?: string;
  result?: unknown;
};

export type AgentApprovalRequest = {
  name: "execute_javascript";
  code: string;
};

export type AgentApprovalHandler = (request: AgentApprovalRequest) => Promise<boolean>;

const objectParameters = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const SWAY_AGENT_TOOLS = [
  {
    type: "function",
    function: {
      name: "router_overview",
      description: "Inspect the local Sway Router status. The result explicitly separates totalProviders (the unique union of built-in registry providers and custom provider nodes, including zero-connection providers), registeredProviderTypes, providerNodes, configuredProviders, activeProviders, inactiveOnlyProviders, connections, API keys, proxy pools, combos, admission load, and safe settings. When asked for the total number of providers, use totalProviders, not activeProviders or connectedProviders.",
      parameters: objectParameters,
    },
  },
  {
    type: "function",
    function: {
      name: "router_models",
      description: "List models currently exposed by Sway Router, including provider and known capabilities such as vision, tools, reasoning, and image output.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Optional model or provider filter." },
          limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum models to return." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "router_connections",
      description: "Inspect provider connection metadata without exposing API keys or OAuth tokens. Can filter by provider and active state.",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", description: "Optional provider id or alias." },
          active_only: { type: "boolean", description: "Return only active connections." },
          limit: { type: "integer", minimum: 1, maximum: 100, description: "Maximum connections to return." },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "router_api_keys",
      description: "Inspect gateway API key metadata and active/revoked counts. Never returns key secrets.",
      parameters: {
        type: "object",
        properties: {
          include_revoked: { type: "boolean" },
          limit: { type: "integer", minimum: 1, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web and return bounded, normalized results. Use it when current or external information is needed.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The web search query." },
          max_results: { type: "integer", minimum: 1, maximum: 8 },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workspace",
      description: "Read the local workspace using safe read-only commands: pwd, ls/dir, cat/type, rg, and read-only git status/diff/log/show/branch.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "A safe read-only workspace command." },
        },
        required: ["command"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "curl",
      description: "Fetch a public HTTP(S) URL with a bounded GET or HEAD request. Private and loopback targets are blocked.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Public http(s) URL." },
          method: { type: "string", enum: ["GET", "HEAD"] },
        },
        required: ["url"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "execute_javascript",
      description: "Run a short JavaScript diagnostic in the local workspace. This always requires explicit user approval before execution.",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "JavaScript diagnostic code, maximum 6000 characters." },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_image",
      description: "Generate an image through an enabled Sway Router media provider. Use only when the user asks for an image and report clearly if media generation is not configured.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "Detailed image prompt." },
          provider: { type: "string", description: "Optional enabled media provider." },
          model: { type: "string", description: "Optional image model." },
          size: { type: "string", enum: ["256x256", "512x512", "1024x1024"] },
          n: { type: "integer", minimum: 1, maximum: 4 },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  },
] as const;

const LABELS: Record<string, string> = {
  router_overview: "Checking Router status",
  router_models: "Inspecting models",
  router_connections: "Inspecting connections",
  router_api_keys: "Inspecting API keys",
  web_search: "Searching the web",
  read_workspace: "Reading workspace",
  curl: "Fetching URL",
  execute_javascript: "Running JavaScript",
  generate_image: "Generating image",
};

export function agentToolLabel(name: string): string {
  return LABELS[name] || "Using agent tool";
}

async function postJson(url: string, body: unknown, apiKey = "") {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  const response = await fetch(url, { method: "POST", credentials: "include", headers, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const error = payload?.error;
    const message = typeof error === "string"
      ? error
      : error && typeof error === "object" && typeof (error as Record<string, unknown>).message === "string"
        ? (error as Record<string, unknown>).message as string
        : typeof payload?.message === "string" ? payload.message : `Tool request failed (${response.status})`;
    throw new Error(message);
  }
  return payload ?? { ok: true };
}

export async function executeSwayTool(
  name: string,
  args: Record<string, unknown>,
  options: { apiKey?: string; approve?: AgentApprovalHandler } = {},
): Promise<Record<string, unknown>> {
  const apiKey = options.apiKey || "";
  if (name === "router_overview") return postJson("/api/chat/tools/router", { action: "overview" }, apiKey);
  if (name === "router_models") return postJson("/api/chat/tools/router", { action: "models", query: args.query, limit: args.limit }, apiKey);
  if (name === "router_connections") return postJson("/api/chat/tools/router", { action: "connections", provider: args.provider, active_only: args.active_only, limit: args.limit }, apiKey);
  if (name === "router_api_keys") return postJson("/api/chat/tools/router", { action: "api_keys", include_revoked: args.include_revoked, limit: args.limit }, apiKey);
  if (name === "web_search") return postJson("/api/chat/tools/search", { query: args.query, max_results: args.max_results }, apiKey);
  if (name === "read_workspace") return postJson("/api/chat/tools/shell", { command: args.command }, apiKey);
  if (name === "curl") return postJson("/api/chat/tools/curl", { url: args.url, method: args.method }, apiKey);
  if (name === "generate_image") return postJson("/api/v1/images/generations", {
    prompt: args.prompt,
    provider: args.provider,
    model: args.model,
    size: args.size,
    n: args.n,
    response_format: "b64_json",
  }, apiKey);
  if (name === "execute_javascript") {
    const code = typeof args.code === "string" ? args.code : "";
    if (!options.approve) throw new Error("JavaScript execution requires user approval");
    const approved = await options.approve({ name: "execute_javascript", code });
    if (!approved) return { ok: false, denied: true, error: "User denied JavaScript execution" };
    return postJson("/api/chat/tools/shell", { mode: "execute", approved: true, code }, apiKey);
  }
  throw new Error(`Unknown agent tool: ${name}`);
}

export function compactToolResult(value: unknown, maxChars = 12_000): string {
  let normalized = value;
  if (normalized && typeof normalized === "object") {
    try {
      normalized = JSON.parse(JSON.stringify(normalized, (key, item) => {
        if (key === "b64_json" && typeof item === "string") return `[image data omitted: ${item.length} bytes]`;
        if (key === "body" && typeof item === "string" && item.length > 6_000) return `${item.slice(0, 6_000)}… [body truncated]`;
        return item;
      }));
    } catch {
      normalized = String(normalized);
    }
  }
  const text = typeof normalized === "string" ? normalized : JSON.stringify(normalized);
  return text.length > maxChars ? `${text.slice(0, maxChars)}… [tool result truncated]` : text;
}
