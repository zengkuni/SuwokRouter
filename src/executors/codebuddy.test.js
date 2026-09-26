import { describe, expect, test } from "bun:test";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "./codebuddy-intl.js";

describe("CodeBuddy prompt preservation", () => {
  test("CodeBuddy CN preserves long and agent-specific system prompts", () => {
    const systemPrompt = `You are Claude Code, Anthropic's official CLI. ${"Keep the agent instructions intact. ".repeat(100)}`;
    const body = { messages: [{ role: "system", content: systemPrompt }] };
    const transformed = new CodeBuddyExecutor().transformRequest("default-model", body, true, {});

    expect(transformed.messages[0].content).toBe(systemPrompt);
  });

  test("CodeBuddy Intl preserves caller system/developer instructions without adding an identity", () => {
    const body = {
      messages: [
        { role: "system", content: "SOUL.md: preserve the user's working style." },
        { role: "developer", content: "Always return valid JSON." },
        { role: "user", content: "Hello" },
      ],
    };
    const transformed = new CodeBuddyIntlExecutor().transformRequest("default-model", body, true, {});

    expect(transformed.messages).toEqual([
      { role: "system", content: "SOUL.md: preserve the user's working style." },
      { role: "system", content: "Always return valid JSON." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  test("CodeBuddy Intl prepends a system prompt for a bare user request", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    const transformed = new CodeBuddyIntlExecutor().transformRequest("default-model", body, true, {});

    // Upstream answers 11128 "first message is not system prompt" otherwise.
    expect(transformed.messages[0].role).toBe("system");
    expect(transformed.messages[0].content).toBeTruthy();
    expect(transformed.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
  });

  test("CodeBuddy CN prepends a system prompt for a bare user request", () => {
    const body = { messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] };
    const transformed = new CodeBuddyExecutor().transformRequest("default-model", body, true, {});

    expect(transformed.messages.map((message) => message.role)).toEqual(["system", "user", "assistant"]);
    expect(transformed.messages[1].content).toBe("hi");
    expect(transformed.messages[2].content).toBe("yo");
  });

  test("CodeBuddy CN keeps an existing system prompt first", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "system", content: "Late system instruction" },
      ],
    };
    const transformed = new CodeBuddyExecutor().transformRequest("default-model", body, true, {});

    expect(transformed.messages.map((message) => message.role)).toEqual(["system", "user"]);
    expect(transformed.messages[0].content).toBe("Late system instruction");
  });
});
