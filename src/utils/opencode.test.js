import { describe, expect, test } from "bun:test";
import {
  applyOpenCodeFingerprint,
  buildOpenCodeHeaders,
  isOpenCodeId,
} from "./opencode.js";

describe("OpenCode fingerprint", () => {
  test("adds the canonical free-tier tool quartet without touching prompt messages", () => {
    const body = {
      model: "mimo-v2.5-free",
      messages: [{ role: "system", content: "Keep the user's system prompt unchanged." }],
    };

    const result = applyOpenCodeFingerprint(body, "openai", { forceStream: true });

    expect(result.messages).toEqual(body.messages);
    expect(result.stream).toBe(true);
    expect(result.tool_choice).toBe("none");
    expect(result.tools.map((tool) => tool.function.name)).toEqual(["bash", "glob", "grep", "read"]);
  });

  test("normalizes compatibility tool casing and preserves an existing choice", () => {
    const result = applyOpenCodeFingerprint({
      tools: [{ type: "function", function: { name: "Bash", parameters: { type: "object" } } }],
      tool_choice: { type: "function", function: { name: "Bash" } },
      stream: false,
    });

    expect(result.tools.map((tool) => tool.function.name)).toEqual(["bash", "glob", "grep", "read"]);
    expect(result.tool_choice.function.name).toBe("bash");
    expect(result.stream).toBe(false);
  });

  test("uses Responses tool shape and strips encrypted reasoning continuity", () => {
    const result = applyOpenCodeFingerprint({
      input: [{ type: "reasoning", encrypted_content: "secret" }],
    }, "responses", { forceStream: true });

    expect(result.stream).toBe(true);
    expect(result.store).toBe(false);
    expect(result.input[0].encrypted_content).toBeUndefined();
    expect(result.tools[0].type).toBe("function");
    expect(result.tools[0].function).toBeUndefined();
    expect(result.tool_choice).toBe("auto");
  });

  test("builds OpenCode session and request headers", () => {
    const headers = buildOpenCodeHeaders({ connectionId: "connection-1" }, true);

    expect(headers.Authorization).toBe("Bearer public");
    expect(headers["User-Agent"]).toBe("opencode/1.18.31");
    expect(headers["x-opencode-client"]).toBe("desktop");
    expect(isOpenCodeId(headers["x-opencode-session"], "ses")).toBe(true);
    expect(isOpenCodeId(headers["x-opencode-request"], "msg")).toBe(true);
  });

  test("adds the Anthropic version only to Messages requests", () => {
    const headers = buildOpenCodeHeaders({ apiKey: "zen-key", connectionId: "connection-2" }, true, { format: "claude" });

    expect(headers.Authorization).toBe("Bearer zen-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });
});
