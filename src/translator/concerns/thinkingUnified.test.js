import { describe, expect, test } from "bun:test";
import { applyThinking } from "./thinkingUnified.js";

describe("unified thinking translation", () => {
  test("omits auto effort for OpenAI", () => {
    const body = applyThinking(
      "openai",
      "gpt-5",
      { reasoning_effort: "auto" },
      "openai",
    );

    expect(body.reasoning_effort).toBeUndefined();
    expect(body.thinking).toBeUndefined();
  });

  test("keeps Claude adaptive native for auto without sending guessed effort", () => {
    const body = applyThinking(
      "claude",
      "claude-sonnet-4.6",
      { reasoning_effort: "auto" },
      "claude",
    );

    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config).toBeUndefined();
  });

  test("does not create a manual Claude budget for auto", () => {
    const body = applyThinking(
      "claude",
      "claude-sonnet-4-20250514",
      { reasoning_effort: "auto" },
      "claude",
    );

    expect(body.thinking).toBeUndefined();
    expect(body.output_config).toBeUndefined();
  });

  test("preserves DeepSeek low instead of promoting it to high", () => {
    const body = applyThinking(
      "openai",
      "deepseek-v4",
      { reasoning_effort: "low" },
      "deepseek",
    );

    expect(body.reasoning_effort).toBe("low");
  });

  test("uses custom model capability metadata in the translator", () => {
    const body = applyThinking(
      "openai",
      "router-unknown",
      { reasoning_effort: "high" },
      "openai-compatible-test",
      undefined,
      { reasoning: true, thinkingFormat: "openai" },
    );

    expect(body.reasoning_effort).toBe("high");
  });

  test("strips reasoning from a custom model explicitly marked unsupported", () => {
    const body = applyThinking(
      "openai",
      "router-unknown",
      { reasoning_effort: "high" },
      "openai-compatible-test",
      undefined,
      { reasoning: false },
    );

    expect(body.reasoning_effort).toBeUndefined();
  });
});
