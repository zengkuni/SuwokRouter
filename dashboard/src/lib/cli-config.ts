export type CliConfigInput = {
  toolId: string;
  baseUrl: string;
  apiKey: string;
  primaryModel?: string;
  subagentModel?: string;
  models?: string[];
  fableModel?: string;
  opusModel?: string;
  sonnetModel?: string;
  haikuModel?: string;
};

export type CliConfigResult = {
  format: "json" | "toml" | "yaml" | "env";
  fileName: string;
  content: string;
  modelCount: number;
  complete: boolean;
  message?: string;
};

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!trimmed || trimmed === "—") return "";
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function cleanModels(input: CliConfigInput): string[] {
  return [...new Set((input.models ?? []).filter((model): model is string => Boolean(model?.trim())).map((model) => model.trim()))];
}

function effectiveModel(input: CliConfigInput, models: string[]): string {
  return input.primaryModel?.trim() || models[0] || "";
}

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function shellValue(value: string): string {
  return JSON.stringify(value);
}

function openCodeConfig(input: CliConfigInput, key: string, models: string[]) {
  const active = effectiveModel(input, models);
  const subagent = input.subagentModel?.trim() || active;
  const config: Record<string, unknown> = {
    provider: {
      swayrouter: {
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: normalizeBaseUrl(input.baseUrl), apiKey: key },
        ...(models.length ? { models: Object.fromEntries(models.map((model) => [model, {
          name: model,
          modalities: { input: ["text", "image"], output: ["text"] },
        }])) } : {}),
      },
    },
  };
  if (active) config.model = `swayrouter/${active}`;
  if (subagent) {
    config.agent = {
      explorer: {
        description: "Fast explorer subagent for codebase exploration",
        mode: "subagent",
        model: `swayrouter/${subagent}`,
      },
    };
  }
  return config;
}

export function maskConfigSecret(secret: string): string {
  if (!secret) return "";
  if (secret.length <= 8) return "•".repeat(secret.length);
  return `${secret.slice(0, 4)}${"•".repeat(Math.min(16, secret.length - 4))}`;
}

export function formatCliConfig(input: CliConfigInput, revealSecret = false): CliConfigResult {
  const models = cleanModels(input);
  const key = revealSecret ? input.apiKey : maskConfigSecret(input.apiKey);
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const model = effectiveModel(input, models);
  const complete = input.toolId === "omp"
    ? Boolean(baseUrl)
    : Boolean(baseUrl && input.apiKey);
  const commonMessage = complete
    ? undefined
    : input.toolId === "omp"
      ? "Ensure the OMP gateway endpoint is available."
      : "Ensure an endpoint and API key are available.";

  switch (input.toolId) {
    case "opencode":
      return {
        format: "json",
        fileName: "opencode.json",
        content: json(openCodeConfig(input, key, models)),
        modelCount: models.length,
        complete,
        message: commonMessage,
      };
    case "omp": {
      const providerModels = models.length
        ? `    models:\n${models.map((id) => `      - id: ${JSON.stringify(id)}\n        name: ${JSON.stringify(id)}`).join("\n")}\n`
        : "";
      const authConfig = input.apiKey
        ? `    apiKey: ${JSON.stringify(key)}\n`
        : "    auth: none\n";
      return {
        format: "yaml",
        fileName: "~/.omp/agent/models.yml",
        content: `providers:\n  swayrouter:\n    baseUrl: ${normalizeBaseUrl(input.baseUrl)}\n    api: openai-completions\n${authConfig}    discovery:\n      type: openai-models-list\n${providerModels}`,
        modelCount: models.length,
        complete,
        message: commonMessage,
      };
    }
    case "claude": {
      const env: Record<string, string> = {
        ANTHROPIC_BASE_URL: baseUrl.replace(/\/v1$/, ""),
        ANTHROPIC_AUTH_TOKEN: key,
        API_TIMEOUT_MS: "600000",
      };
      const tierModels = {
        ANTHROPIC_DEFAULT_FABLE_MODEL: input.fableModel?.trim() || model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: input.opusModel?.trim() || model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: input.sonnetModel?.trim() || model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: input.haikuModel?.trim() || model,
      };
      for (const [name, value] of Object.entries(tierModels)) {
        if (value) env[name] = value;
      }
      return {
        format: "env",
        fileName: ".env",
        content: Object.entries(env).map(([name, value]) => `${name}=${shellValue(value)}`).join("\n") + "\n",
        modelCount: models.length,
        complete,
        message: commonMessage,
      };
    }
    case "codex": {
      const codexLines = [
        ...(model ? [`model = ${shellValue(model)}`] : []),
        'model_provider = "swayrouter"',
        "",
        "[model_providers.swayrouter]",
        'name = "Sway Router"',
        `base_url = ${shellValue(baseUrl)}`,
        'wire_api = "responses"',
      ];
      const subagent = input.subagentModel?.trim() || model;
      if (subagent) codexLines.push("", "[agents.subagent]", `model = ${shellValue(subagent)}`);
      codexLines.push(
        "",
        "# Write this credential to auth.json (Codex reads it separately):",
        json({ OPENAI_API_KEY: key, auth_mode: "apikey" }),
      );
      return {
        format: "toml",
        fileName: "config.toml + auth.json",
        content: codexLines.join("\n") + "\n",
        modelCount: models.length,
        complete,
        message: commonMessage,
      };
    }
    case "hermes":
      return {
        format: "yaml",
        fileName: "config.yaml + .env",
        content: `model:\n  default: ${JSON.stringify(model)}\n  provider: "custom"\n  base_url: ${JSON.stringify(baseUrl)}\n\n# Add to .env\nOPENAI_API_KEY=${shellValue(key)}\n`,
        modelCount: models.length,
        complete,
        message: commonMessage,
      };
    default:
      return {
        format: "json",
        fileName: `${input.toolId}.json`,
        content: json({ baseUrl, apiKey: key, model, subagentModel: input.subagentModel?.trim() || model }),
        modelCount: models.length,
        complete,
        message: commonMessage,
      };
  }
}
