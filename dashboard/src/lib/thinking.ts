export type ThinkingLevel =
  | "auto"
  | "none"
  | "on"
  | "off"
  | "thinking"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";

export type ProviderThinkingConfig = {
  options?: string[];
  defaultMode?: string;
  modelAware?: boolean;
};

const FULL: ThinkingLevel[] = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const STANDARD: ThinkingLevel[] = [
  "auto",
  "low",
  "medium",
  "high",
  "max",
];

const SUPPORT: Record<string, ThinkingLevel[]> = {
  openai: FULL,
  claude: STANDARD,
  deepseek: ["auto", "low", "high", "max"],
  groq: ["auto", "low", "medium", "high"],
  openrouter: STANDARD,
  kimi: STANDARD,
  glm: ["auto", "low", "medium", "high"],
  minimax: ["auto", "low", "medium", "high"],
  kiro: ["auto", "low", "medium", "high"],
  codex: ["auto", "low", "medium", "high", "xhigh"],
  github: ["auto", "low", "medium", "high"],
  cursor: ["auto", "low", "medium", "high"],
  "gemini-cli": ["auto", "low", "medium", "high"],
  "grok-cli": ["auto", "low", "medium", "high"],
  "ollama-local": ["auto", "low", "medium", "high"],
  antigravity: ["auto", "low", "medium", "high"],
  qwen: ["auto", "low", "medium", "high"],
  "codebuddy-cn": ["auto", "low", "medium", "high"],
};

const THINKING_LEVEL_ORDER: ThinkingLevel[] = [
  "auto",
  "none",
  "on",
  "off",
  "thinking",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
];

const CONFIG_LEVEL_ALIASES: Record<string, ThinkingLevel> = {
  "x-high": "xhigh",
  maximum: "max",
};

function normalizeConfiguredLevel(value: unknown): ThinkingLevel | null {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  if (raw in CONFIG_LEVEL_ALIASES) return CONFIG_LEVEL_ALIASES[raw];
  return ["auto", "none", "on", "off", "thinking", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]
    .includes(raw)
    ? raw as ThinkingLevel
    : null;
}

function configuredLevels(config?: ProviderThinkingConfig | null): ThinkingLevel[] {
  if (!Array.isArray(config?.options)) return [];
  const levels = config.options.flatMap((option) => {
    const level = normalizeConfiguredLevel(option);
    return level ? [level] : [];
  });
  const unique = [...new Set(levels)];
  if (!unique.length) return [];

  const hasToggleOnlyOptions = unique.every((level) => ["auto", "on", "off"].includes(level));
  if (!unique.includes("auto") && !hasToggleOnlyOptions) unique.unshift("auto");
  return unique;
}

function normalizeThinkingLevels(values: unknown): ThinkingLevel[] {
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    const level = normalizeConfiguredLevel(value);
    return level ? [level] : [];
  });
}

export function getThinkingLevelsForModels(
  providerId: string,
  modelLevels: ReadonlyArray<ReadonlyArray<string> | null | undefined>,
  config?: ProviderThinkingConfig | null,
): ThinkingLevel[] | null {
  if (config?.modelAware === false) return getThinkingLevelsForProvider(providerId, config);

  const knownModels = modelLevels
    .map((levels) => new Set(normalizeThinkingLevels(levels)))
    .filter((levels) => levels.size > 0);
  if (!knownModels.length) {
    const isCompatibleCustom =
      providerId.startsWith("openai-compatible-") ||
      providerId.startsWith("anthropic-compatible-");
    return isCompatibleCustom ? null : getThinkingLevelsForProvider(providerId, config);
  }

  const availableLevels = THINKING_LEVEL_ORDER.filter(
    (level) => level !== "auto" && level !== "none" && knownModels.some((levels) => levels.has(level)),
  );
  return ["auto", ...availableLevels];
}

export function getThinkingLevelsForProvider(
  providerId: string,
  config?: ProviderThinkingConfig | null,
): ThinkingLevel[] | null {
  if (
    providerId.startsWith("openai-compatible-") ||
    providerId.startsWith("anthropic-compatible-")
  ) {
    return ["auto", "low", "medium", "high", "max"];
  }
  const registryLevels = configuredLevels(config);
  return registryLevels.length > 0 ? registryLevels : SUPPORT[providerId] || null;
}

export function defaultThinkingLevel(
  providerId: string,
  config?: ProviderThinkingConfig | null,
): ThinkingLevel {
  const levels = getThinkingLevelsForProvider(providerId, config);
  const configuredDefault = normalizeConfiguredLevel(config?.defaultMode);
  if (configuredDefault && levels?.includes(configuredDefault)) return configuredDefault;
  if (!levels?.length) return "auto";
  if (levels.includes("auto")) return "auto";
  if (levels.includes("high")) return "high";
  return levels[0];
}

export function thinkingLabel(level: ThinkingLevel): string {
  if (level === "auto") return "Auto";
  if (level === "xhigh") return "xHigh";
  if (level === "thinking") return "Thinking";
  return level.charAt(0).toUpperCase() + level.slice(1);
}
