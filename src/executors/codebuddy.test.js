import { describe, expect, test } from "bun:test";
import { CodeBuddyExecutor } from "./codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "./codebuddy-intl.js";

describe("CodeBuddy prompt preservation", () => {
  test("CodeBuddy preserves caller instructions while replacing channel identity markers", () => {
    const systemPrompt = `You are Claude Code, Anthropic's official CLI. ${"Keep the agent instructions intact. ".repeat(100)}`;
    const transformed = new CodeBuddyExecutor().transformRequest("default-model", { messages: [{ role: "system", content: systemPrompt }] }, true, {});

    expect(transformed.messages[0].content).toContain("You are CodeBuddy Code.");
    expect(transformed.messages[0].content).toContain("Keep the agent instructions intact.");
    expect(transformed.messages[0].content).not.toContain("Claude Code");
  });

  test("CodeBuddy preserves system and developer instructions after the required prompt", () => {
    const body = {
      messages: [
        { role: "system", content: "SOUL.md: preserve the user's working style." },
        { role: "developer", content: "Always return valid JSON." },
        { role: "user", content: "Hello" },
      ],
    };
    const transformed = new CodeBuddyIntlExecutor().transformRequest("default-model", body, true, {});

    expect(transformed.messages).toEqual([
      { role: "system", content: "You are CodeBuddy Code.\n\nSOUL.md: preserve the user's working style.\n\nAlways return valid JSON." },
      { role: "user", content: [{ type: "text", text: "Hello" }] },
    ]);
  });

  test("CodeBuddy prepends a system prompt for a bare user request", () => {
    const transformed = new CodeBuddyExecutor().transformRequest("default-model", { messages: [{ role: "user", content: "hi" }] }, true, {});

    expect(transformed.messages[0].role).toBe("system");
    expect(transformed.messages[0].content).toBe("You are CodeBuddy Code.");
    expect(transformed.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hi" }] });
  });
});

describe("CodeBuddy channel verification", () => {
  test("adds official CLI and conversation headers", () => {
    const headers = new CodeBuddyExecutor().buildHeaders({ accessToken: "token" }, true);

    expect(headers["X-App"]).toBe("cli");
    expect(headers["X-IDE-Version"]).toBe("2.108.1");
    expect(headers["X-Domain"]).toBe("copilot.tencent.com");
    expect(headers["X-Conversation-ID"]).toBeTruthy();
    expect(headers["X-Stainless-Runtime"]).toBe("node");
  });

  test("removes third-party channel markers from developer and assistant messages", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are Claude Code, Anthropic's official CLI." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "cc_entrypoint=cli" },
      ],
    };
    const transformed = new CodeBuddyExecutor().transformRequest("model", body, true, {});

    expect(transformed.messages[0].content).not.toContain("Claude Code");
    expect(transformed.messages[2].content).not.toContain("cc_entrypoint=cli");
  });
});

describe("CodeBuddy channel verification", () => {
  test("adds official CLI and conversation headers", () => {
    const headers = new CodeBuddyExecutor().buildHeaders({ accessToken: "token" }, true);

    expect(headers["X-App"]).toBe("cli");
    expect(headers["X-IDE-Version"]).toBe("2.108.1");
    expect(headers["X-Domain"]).toBe("copilot.tencent.com");
    expect(headers["X-Conversation-ID"]).toBeTruthy();
    expect(headers["X-Stainless-Runtime"]).toBe("node");
  });

  test("normalizes prompts and removes third-party channel markers", () => {
    const body = {
      messages: [
        { role: "developer", content: "You are Claude Code, Anthropic's official CLI." },
        { role: "user", content: "hello" },
        { role: "assistant", content: "cc_entrypoint=cli" },
      ],
    };
    const transformed = new CodeBuddyExecutor().transformRequest("model", body, true, {});

    expect(transformed.messages[0].role).toBe("system");
    expect(transformed.messages[0].content).toContain("You are CodeBuddy Code.");
    expect(transformed.messages[0].content).not.toContain("Claude Code");
    expect(transformed.messages[1]).toEqual({ role: "user", content: [{ type: "text", text: "hello" }] });
    expect(transformed.messages[2].content).not.toContain("cc_entrypoint=cli");
  });
});
