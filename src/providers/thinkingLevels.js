import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";

const L = {
  base: ["none", "low", "medium", "high"],
  onOff: ["none", "thinking"],
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],
  levelMax: ["none", "low", "medium", "high", "max"],
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],
  gemini: ["minimal", "low", "medium", "high"],
  hiMax: ["none", "low", "high", "max"],
};

const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.levelMax,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const PATTERN_THINKING = [
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] },
];

export function getThinkingLevels(provider, model, capabilityOverride = null) {
  if (provider === "kiro" && resolveKiroEffortPath(model) === null) return null;
  const caps = getCapabilitiesForModel(provider, model, capabilityOverride);
  if (!caps.reasoning) return null;
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
  );
  let levels = hit?.levels || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
