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
});
