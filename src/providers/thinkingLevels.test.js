import { describe, expect, test } from "bun:test";
import REGISTRY from "./registry/index.js";
import { getCapabilitiesForModel } from "./capabilities.js";
import { getThinkingLevels } from "./thinkingLevels.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";

function isKiroVariantWithoutEffort(provider, model) {
  return provider === "kiro" && resolveKiroEffortPath(model) === null;
}

describe("registry thinking metadata", () => {
  test("exposes native levels for every registry reasoning model", () => {
    const missing = [];

    for (const provider of REGISTRY) {
      for (const model of provider.models || []) {
        const caps = getCapabilitiesForModel(provider.id, model.id);
        if (!caps.reasoning || isKiroVariantWithoutEffort(provider.id, model.id)) continue;
        const levels = getThinkingLevels(provider.id, model.id);
        if (!Array.isArray(levels) || levels.length === 0) {
          missing.push(`${provider.id}/${model.id}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  test("keeps the model-specific ladders used by the main providers", () => {
    expect(getThinkingLevels("antigravity", "claude-opus-4-6-thinking")).toEqual([
      "none", "low", "medium", "high", "xhigh", "max",
    ]);
    expect(getThinkingLevels("codex", "gpt-5.6-sol")).toEqual([
      "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
    ]);
    expect(getThinkingLevels("grok-cli", "grok-4.6")).toEqual([
      "none", "minimal", "low", "medium", "high", "xhigh",
    ]);
  });
});
