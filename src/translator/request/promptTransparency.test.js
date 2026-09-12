import { describe, expect, test } from "bun:test";
import { DefaultExecutor } from "../../executors/default.js";
import { CodexExecutor } from "../../executors/codex.js";
import { claudeToKiroRequest } from "./claude-to-kiro.js";
import { claudeToOpenAIRequest } from "./claude-to-openai.js";
import { openaiToOpenAIResponsesRequest } from "./openai-responses.js";
import { openaiToClaudeRequest } from "./openai-to-claude.js";
import { openaiToCursorRequest } from "./openai-to-cursor.js";
import { openaiToAntigravityRequest, openaiToGeminiRequest } from "./openai-to-gemini.js";
import { openaiToKiroRequest } from "./openai-to-kiro.js";
import { prepareClaudeRequest } from "../formats/claude.js";

const systemPrompt = "SOUL.md: use the user's exact agent identity and working style.";
const developerPrompt = "CLAUDE.md: follow the repository instructions exactly.";

describe("prompt transparency", () => {
  test("custom OpenAI-compatible providers keep native response_format without injecting a prompt", () => {
    const body = {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: developerPrompt },
        { role: "user", content: "Return data" },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: "result", schema: { type: "object" } },
      },
    };

    const result = new DefaultExecutor("openai-compatible-test").transformRequest("test-model", body);

    expect(result.messages[0].content).toBe(systemPrompt);
    expect(result.messages[1]).toEqual({ role: "developer", content: developerPrompt });
    expect(result.response_format).toEqual(body.response_format);
  });

  test("Codex does not create default instructions", () => {
    const body = {
      model: "gpt-5.1-codex",
      input: [{ type: "message", role: "user", content: "Hello" }],
    };

    const result = new CodexExecutor().transformRequest("gpt-5.1-codex", body, true, {});

    expect(result.instructions).toBeUndefined();
    expect(result.input[0].content).toBe("Hello");
  });

  test("OpenAI to Claude forwards only caller system content", () => {
    const result = openaiToClaudeRequest("claude-sonnet-4-5", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: developerPrompt },
        { role: "user", content: "Hello" },
      ],
      response_format: { type: "json_object" },
    }, true);

    expect(result.system).toEqual([{
      type: "text",
      text: `${systemPrompt}\n\n${developerPrompt}`,
      cache_control: { type: "ephemeral", ttl: "1h" },
    }]);
  });

  test("Claude OAuth requests are not cloaked with router-owned prompts or tools", () => {
    const result = prepareClaudeRequest({
      model: "claude-sonnet-4-5",
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ name: "user_tool", description: "User tool", input_schema: { type: "object" } }],
    }, "claude", "sk-ant-oat-test");

    expect(result.system).toBeUndefined();
    expect(result.metadata).toBeUndefined();
    expect(result.tools.map((tool) => tool.name)).toEqual(["user_tool"]);
  });

  test("OpenAI to Kiro keeps system content out of user messages", () => {
    const result = openaiToKiroRequest("claude-sonnet-4-5", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Hello" },
      ],
    }, true, { connectionId: "prompt-openai-kiro" });

    expect(result.systemPrompt).toBe(systemPrompt);
    expect(result.conversationState.currentMessage.userInputMessage.content).toBe("Hello");
  });

  test("Claude to Kiro forwards only the caller system prompt", () => {
    const result = claudeToKiroRequest("claude-sonnet-4-5-agentic", {
      system: [{ type: "text", text: systemPrompt }, { type: "text", text: developerPrompt }],
      messages: [{ role: "user", content: "Hello" }],
    }, true, { connectionId: "prompt-claude-kiro" });

    expect(result.systemPrompt).toBe(`${systemPrompt}\n\n${developerPrompt}`);
    expect(result.conversationState.currentMessage.userInputMessage.content).toBe("Hello");
  });

  test("Claude to OpenAI preserves top-level and message-level system content", () => {
    const result = claudeToOpenAIRequest("model", {
      system: systemPrompt,
      messages: [
        { role: "developer", content: developerPrompt },
        { role: "user", content: "Hello" },
      ],
    }, true);

    expect(result.messages[0]).toEqual({ role: "system", content: systemPrompt });
    expect(result.messages[1]).toEqual({ role: "system", content: developerPrompt });
  });

  test("OpenAI Responses combines all caller instruction messages", () => {
    const result = openaiToOpenAIResponsesRequest("gpt-5", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "developer", content: developerPrompt },
        { role: "user", content: "Hello" },
      ],
    }, true, {});

    expect(result.instructions).toBe(`${systemPrompt}\n\n${developerPrompt}`);
  });

  test("OpenAI to Gemini combines all caller system messages", () => {
    const result = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "system", content: developerPrompt },
        { role: "user", content: "Hello" },
      ],
    }, true);

    expect(result.systemInstruction.parts).toEqual([{ text: `${systemPrompt}\n\n${developerPrompt}` }]);
    expect(result.contents[0].parts).toEqual([{ text: "Hello" }]);
  });

  test("Antigravity forwards only caller-provided prompts and tools", () => {
    const result = openaiToAntigravityRequest("gemini-2.5-pro", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Hello" },
      ],
      tools: [{
        type: "function",
        function: {
          name: "user_tool",
          description: "User tool",
          parameters: { type: "object", properties: {} },
        },
      }],
    }, true, { connectionId: "prompt-antigravity" });

    expect(result.request.systemInstruction.parts).toEqual([{ text: systemPrompt }]);
    expect(result.request.tools[0].functionDeclarations.map((tool) => tool.name)).toEqual(["user_tool"]);
  });

  test("OpenAI to Cursor does not add a system wrapper", () => {
    const result = openaiToCursorRequest("cursor-model", {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: "Hello" },
      ],
    }, true, {});

    expect(result.messages[0]).toEqual({ role: "system", content: systemPrompt });
  });

});
