import { api, beautifyPath } from "@/lib/api";
import { getActiveGatewayApiKey } from "@/lib/api-keys-api";
export type CliTool = {
  id: string;
  name: string;
  tier: "config" | "detection";
  installed: boolean;
  connected: boolean;
  available: boolean;
  configPath?: string;
  detail?: string;
  version?: string;
  models?: string[];
  raw?: Record<string, unknown>;
};

export type CliToolsResponse = {
  tools: CliTool[];
  origin: string;
  apiKey: string;
};

export type CliModelMappingEntry = {
  sourceModel: string;
  targetModel: string;
  enabled: boolean;
};

export type CliModelMappingSnapshot = {
  enabled: boolean;
  entries: CliModelMappingEntry[];
};

export type CliModelMappings = Record<string, CliModelMappingSnapshot>;

export type ConnectBody = {
  baseUrl?: string;
  apiKey?: string;
  models?: string[];
  primaryModel?: string;
  activeModel?: string;
  subagentModel?: string;
  fableModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
  exaMcpEnabled?: boolean;
  cliModelMappings?: CliModelMappings;
};

export type ModelInfo = { id: string; name: string; provider: string; capabilities?: Record<string, unknown> };

function normalizeCliModelMappings(value: unknown): CliModelMappings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: CliModelMappings = {};
  for (const [toolId, rawSnapshot] of Object.entries(value)) {
    if (!rawSnapshot || typeof rawSnapshot !== "object" || Array.isArray(rawSnapshot)) continue;
    const snapshot = rawSnapshot as { enabled?: unknown; entries?: unknown };
    const entries = Array.isArray(snapshot.entries)
      ? snapshot.entries.flatMap((rawEntry) => {
          if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) return [];
          const entry = rawEntry as Record<string, unknown>;
          const sourceModel = typeof entry.sourceModel === "string" ? entry.sourceModel.trim() : "";
          const targetModel = typeof entry.targetModel === "string" ? entry.targetModel.trim() : "";
          return sourceModel && targetModel
            ? [{ sourceModel, targetModel, enabled: entry.enabled !== false }]
            : [];
        })
      : [];
    result[toolId] = { enabled: snapshot.enabled !== false, entries };
  }
  return result;
}

export async function fetchCliModelMappings(): Promise<CliModelMappings> {
  const { data } = await api.get<{ mappings?: unknown }>("/cli-tools/model-mappings");
  return normalizeCliModelMappings(data?.mappings);
}

export async function saveCliModelMappings(mappings: CliModelMappings): Promise<CliModelMappings> {
  const { data } = await api.put<{ mappings?: unknown }>("/cli-tools/model-mappings", { mappings });
  return normalizeCliModelMappings(data?.mappings);
}

export async function resetCliModelMappings(): Promise<CliModelMappings> {
  const { data } = await api.delete<{ mappings?: unknown }>("/cli-tools/model-mappings");
  return normalizeCliModelMappings(data?.mappings);
}

const TOOL_META: Record<string, { name: string; tier: CliTool["tier"] }> = {
  claude: { name: "Claude Code", tier: "config" },
  codex: { name: "Codex CLI", tier: "config" },
  opencode: { name: "OpenCode", tier: "config" },
  hermes: { name: "Hermes Agent", tier: "config" },
  cowork: { name: "Claude Cowork", tier: "config" },
  kilo: { name: "Kilo Code", tier: "config" },
  "grok-build": { name: "Grok Build", tier: "config" },
  omp: { name: "OMP (oh-my-pi)", tier: "config" },
};

const TOOL_IDS = Object.keys(TOOL_META);

function boolStatus(s: Record<string, unknown>, ...keys: string[]) {
  return keys.some((key) => s[key] === true);
}

function extractModels(
  id: string,
  raw: Record<string, unknown> | null
): string[] | undefined {
  if (!raw) return undefined;

  if (id === "claude") {
    const env = (raw.settings as { env?: Record<string, unknown> } | undefined)
      ?.env;
    const tiers = ["FABLE", "OPUS", "SONNET", "HAIKU"];
    const models = tiers
      .map((t) => env?.[`ANTHROPIC_DEFAULT_${t}_MODEL`])
      .filter((m): m is string => typeof m === "string" && m.length > 0);
    return models.length ? models : undefined;
  }

  if (id === "hermes") {
    const def = (raw.settings as { model?: { default?: unknown } } | undefined)
      ?.model?.default;
    return typeof def === "string" && def ? [def] : undefined;
  }

  if (id === "codex") {
    const config = typeof raw.config === "string" ? raw.config : "";
    const m = config.match(/^model\s*=\s*["']([^"'\r\n]+)["']/m);
    return m ? [m[1].trim()] : undefined;
  }

  if (Array.isArray(raw.models)) {
    return raw.models.filter((x): x is string => typeof x === "string");
  }
  return undefined;
}

export async function fetchCliTools(): Promise<CliToolsResponse> {
  const { data } = await api.get<Record<string, Record<string, unknown> | null>>(
    "/cli-tools/all-statuses"
  );
  const tools = TOOL_IDS.map((id) => {
    const raw = data?.[id] ?? null;
    const meta = TOOL_META[id];
    if (!raw) {
      return { id, name: meta.name, tier: meta.tier, installed: false, connected: false, available: false, detail: "Status unavailable" };
    }
    const installed = raw.installed !== false;
    const connected = boolStatus(raw, "hasSwayRouter", "connected");
    return {
      id,
      name: meta.name,
      tier: meta.tier,
      installed,
      connected,
      available: true,
      configPath: beautifyPath(typeof raw.settingsPath === "string" ? raw.settingsPath : typeof raw.configPath === "string" ? raw.configPath : undefined),
      detail: typeof raw.message === "string" ? raw.message : undefined,
      version: typeof raw.version === "string" ? raw.version : undefined,
      models: extractModels(id, raw),
      raw,
    };
  });
  return { tools, origin: typeof window !== "undefined" ? window.location.origin : "", apiKey: "" };
}

function cleanUrl(url: string) {
  return url.trim().replace(/\/$/, "");
}

function modelDefault(id: string): string {
  if (id === "claude") return "claude/claude-sonnet-5";
  if (id === "codex") return "openai/gpt-5";
  return "";
}

function routePayload(id: string, body: ConnectBody) {
  const baseUrl = cleanUrl(body.baseUrl || "");
  const models = body.models?.filter(Boolean) ?? [];
  const model = body.primaryModel || models[0] || modelDefault(id);
  switch (id) {
    case "claude":
      return { env: {
        ANTHROPIC_BASE_URL: baseUrl,
        ANTHROPIC_AUTH_TOKEN: body.apiKey || "",
        ANTHROPIC_DEFAULT_FABLE_MODEL: body.fableModel || model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: body.opusModel || model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: body.sonnetModel || model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: body.haikuModel || model,
        API_TIMEOUT_MS: "600000",
      }, exaMcpEnabled: body.exaMcpEnabled !== false };
    case "codex":
      return { baseUrl, apiKey: body.apiKey || "", model, subagentModel: body.subagentModel || model };
    case "opencode":
      return { baseUrl, apiKey: body.apiKey || "", models: models.length ? models : [model], activeModel: model, subagentModel: body.subagentModel || model };
    case "omp":
      return { baseUrl, apiKey: body.apiKey || "", models, primaryModel: body.primaryModel || model };
    case "cowork":
      return { baseUrl, apiKey: body.apiKey || "", models: models.length ? models : [model] };
    case "grok-build":
      return { baseUrl, apiKey: body.apiKey || "", model };
    default:
      return { baseUrl, apiKey: body.apiKey || "", model };
  }
}

export async function connectCliTool(id: string, body: ConnectBody): Promise<CliTool> {
  const { data } = await api.post<{ success?: boolean; message?: string }>(
    `/cli-tools/${encodeURIComponent(id)}-settings`,
    routePayload(id, body)
  );
  if (data.success === false) throw new Error(data.message || "Configuration failed");
  return { id, name: TOOL_META[id]?.name ?? id, tier: TOOL_META[id]?.tier ?? "config", installed: true, connected: true, available: true, detail: data.message };
}

export async function disconnectCliTool(id: string): Promise<CliTool> {
  return resetCliTool(id);
}

export async function resetCliTool(id: string): Promise<CliTool> {
  const { data } = await api.delete<{ success?: boolean; message?: string }>(`/cli-tools/${encodeURIComponent(id)}-settings`);
  if (data.success === false) throw new Error(data.message || "Reset failed");
  return { id, name: TOOL_META[id]?.name ?? id, tier: TOOL_META[id]?.tier ?? "config", installed: true, connected: false, available: true, detail: data.message };
}

type ModelsPayload = {
  data?: Array<{ id?: string; name?: string; owned_by?: string; capabilities?: Record<string, unknown> }>;
};

export async function fetchModels(): Promise<ModelInfo[]> {
  const apiKey = await getActiveGatewayApiKey().catch(() => "");
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch("/v1/models", {
    credentials: "include",
    headers,
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as ModelsPayload;
  return (payload.data ?? []).flatMap((model) => {
    const id = typeof model.id === "string" ? model.id.trim() : "";
    if (!id) return [];
    const provider = typeof model.owned_by === "string" && model.owned_by
      ? model.owned_by
      : id.includes("/") ? id.split("/", 1)[0] : "other";
    return [{ id, name: model.name?.trim() || id, provider, capabilities: model.capabilities }];
  });
}
