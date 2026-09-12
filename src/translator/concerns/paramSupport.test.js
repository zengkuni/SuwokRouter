import { describe, expect, test } from "bun:test";
import {
  applyModelAwareParameterPolicy,
  defaultMaxTokensForModel,
} from "./paramSupport.js";

describe("model-aware parameter policy", () => {
  test("chooses bounded defaults from the resolved model output capability", () => {
    expect(defaultMaxTokensForModel("custom-provider", "zai-org/GLM-5.3")).toBe(32768);
    expect(defaultMaxTokensForModel("custom-provider", "Qwen/Qwen3.8-27B")).toBe(16384);
    expect(defaultMaxTokensForModel("custom-provider", "deepseek-ai/DeepSeek-V4-Pro")).toBe(65536);
    expect(defaultMaxTokensForModel("custom-provider", "MiniMaxAI/MiniMax-M3")).toBe(65536);
  });

  test("adds only a max token fallback for OpenAI-compatible transports", () => {
    const body = { model: "zai-org/GLM-5.3" };

    applyModelAwareParameterPolicy("custom-provider", body.model, body, { openaiCompatible: true });

    expect(body.max_tokens).toBe(32768);
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
    expect(body.frequency_penalty).toBeUndefined();
    expect(body.presence_penalty).toBeUndefined();
    expect(body.seed).toBeUndefined();
  });

  test("preserves explicit token limits while clamping over the model ceiling", () => {
    const body = {
      model: "zai-org/GLM-5.3",
      max_tokens: 999999,
      temperature: 0.2,
      seed: 42,
    };

    applyModelAwareParameterPolicy("custom-provider", body.model, body, { openaiCompatible: true });

    expect(body.max_tokens).toBe(128000);
    expect(body.temperature).toBe(0.2);
    expect(body.seed).toBe(42);
  });

  test("does not inject a fallback for non-compatible transports", () => {
    const body = { model: "zai-org/GLM-5.3" };

    applyModelAwareParameterPolicy("glm", body.model, body, { openaiCompatible: false });

    expect(body.max_tokens).toBeUndefined();
  });
});
