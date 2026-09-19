import { describe, expect, test } from "bun:test";
import { openaiToCommandCodeRequest } from "./openai-to-commandcode.js";
import { translateRequest } from "../index.js";
import { getProviderModels } from "../../config/providerModels.js";

describe("OpenAI to Command Code translation", () => {
  test("builds the API-key request envelope with system and multimodal content", () => {
    const result = openaiToCommandCodeRequest("deepseek/deepseek-v4-flash", {
      messages: [
        { role: "system", content: "Be concise." },
        {
          role: "user",
          content: [
            { type: "text", text: "Read this image." },
            { type: "image_url", image_url: { url: "data:image/png;base64,AA==" } },
          ],
        },
      ],
      max_tokens: 100,
    }, true);

    expect(result.params.system).toBe("Be concise.");
    expect(result.params.messages[0].content).toEqual([
      { type: "text", text: "Read this image." },
      {
        type: "image",
        image: "data:image/png;base64,AA==",
        mimeType: "image/png",
        mediaType: "image/png",
      },
    ]);
    expect(result.params.stream).toBe(true);
  });

  test("keeps malformed tool arguments instead of silently replacing them", () => {
    const result = openaiToCommandCodeRequest("deepseek/deepseek-v4-flash", {
      messages: [{
        role: "assistant",
        tool_calls: [{
          id: "call_1",
          type: "function",
          function: { name: "lookup", arguments: "{broken" },
        }],
      }],
    }, true);

    expect(result.params.messages[0].content[0]).toEqual({
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "lookup",
      input: { _raw: "{broken" },
    });
  });

  test("places reasoning effort inside params for Command Code", () => {
    const result = translateRequest(
      "openai",
      "commandcode",
      "deepseek/deepseek-v4-flash",
      {
        messages: [{ role: "user", content: "ping" }],
        reasoning_effort: "high",
        max_tokens: 100,
      },
      true,
      null,
      "commandcode",
    );

    expect(result.reasoning_effort).toBeUndefined();
    expect(result.thinking).toBeUndefined();
    expect(result.params.reasoning_effort).toBe("high");
  });

  test("exposes the complete documented Command Code model list", () => {
    expect(getProviderModels("commandcode").map((model) => model.id)).toEqual([
      "deepseek/deepseek-v4-pro",
      "deepseek/deepseek-v4-flash",
      "moonshotai/Kimi-K2.6",
      "moonshotai/Kimi-K2.5",
      "zai-org/GLM-5.1",
      "zai-org/GLM-5",
      "MiniMaxAI/MiniMax-M2.7",
      "MiniMaxAI/MiniMax-M2.5",
      "Qwen/Qwen3.6-Max-Preview",
      "Qwen/Qwen3.6-Plus",
      "stepfun/Step-3.5-Flash",
      "poolside/laguna-s-2.1-free",
      "ling/ling-3.0-flash-sante",
    ]);
  });
});
