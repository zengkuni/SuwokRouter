import { describe, expect, test } from "bun:test";
import {
  defaultThinkingLevel,
  getThinkingLevelsForModels,
  getThinkingLevelsForProvider,
} from "./thinking";

describe("provider thinking UI support", () => {
  test("shows thinking controls for custom OpenAI-compatible providers", () => {
    expect(getThinkingLevelsForProvider("openai-compatible-chat-test")).toEqual([
      "auto",
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(defaultThinkingLevel("openai-compatible-chat-test")).toBe("auto");
  });

  test("does not guess thinking support for a custom model without metadata", () => {
    expect(getThinkingLevelsForModels("openai-compatible-chat-test", [undefined])).toBeNull();
  });

  test("uses provider registry options when available", () => {
    expect(getThinkingLevelsForProvider("grok-cli", {
      options: ["low", "medium", "high", "xhigh"],
      defaultMode: "high",
    })).toEqual(["auto", "low", "medium", "high", "xhigh"]);
    expect(defaultThinkingLevel("grok-cli", {
      options: ["low", "medium", "high", "xhigh"],
      defaultMode: "high",
    })).toBe("high");
  });

  test("shows the union of model thinking levels", () => {
    expect(getThinkingLevelsForModels("codex", [
      ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"],
      ["low", "medium", "high", "xhigh"],
    ], {
      options: ["auto", "low", "medium", "high", "xhigh"],
      defaultMode: "auto",
      modelAware: true,
    })).toEqual(["auto", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
  });

  test("exposes Antigravity levels contributed by different model families", () => {
    expect(getThinkingLevelsForModels("antigravity", [
      ["minimal", "low", "medium", "high"],
      ["none", "low", "medium", "high", "max"],
      ["none", "minimal", "low", "medium", "high", "xhigh"],
    ], { modelAware: true })).toEqual([
      "auto", "minimal", "low", "medium", "high", "xhigh", "max",
    ]);
  });
});
