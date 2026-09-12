import { describe, expect, test } from "bun:test";
import {
  buildModelAwareSystemPrompt,
  buildRequestMessages,
  compactHistory,
  elapsedChatDuration,
  estimateTokens,
  normalizeChatDuration,
  normalizeChatTimestamp,
  normalizePersistedAssistantMessage,
  MAX_CHAT_DURATION_MS,
  MAX_VISIBLE_THINKING_MS,
  shouldCompact,
  readAssistantText,
  readAssistantThinking,
  readStreamUsage,
  groupModels,
  isAcceptedImage,
  formatDuration,
  formatThinkingDuration,
  formatTokenCount,
  getThinkingPhase,
  createId,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PAYLOAD_BYTES,
  MAX_IMAGES_PER_MSG,
  type ChatMessage,
  type ModelInfo,
  parseSwayChatWorkspace,
  reconcileSwayChatModel,
  serializeSwayChatWorkspace,
} from "@/lib/chatStudio";

function um(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: createId(), role: "user", content, ...extra };
}
function am(content: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: createId(), role: "assistant", content, status: "done", ...extra };
}

describe("Sway Chat workspace persistence", () => {
  test("round-trips messages and system prompt", () => {
    const raw = serializeSwayChatWorkspace({ model: "openai/gpt", systemPrompt: "Be concise", messages: [um("hello"), am("hi")] });
    expect(parseSwayChatWorkspace(raw)).toMatchObject({ model: "openai/gpt", systemPrompt: "Be concise", messages: [{ content: "hello" }, { content: "hi" }] });
  });

  test("rejects malformed or unsupported workspace data", () => {
    expect(parseSwayChatWorkspace("not json")).toBeNull();
    expect(parseSwayChatWorkspace(JSON.stringify({ schemaVersion: 99, messages: [] }))).toBeNull();
  });

  test("filters malformed messages and reconciles unavailable models", () => {
    const raw = JSON.stringify({ schemaVersion: 1, model: "gone", systemPrompt: "x", messages: [um("ok"), { role: "user" }, { role: "system", id: "bad", content: "drop" }] });
    expect(parseSwayChatWorkspace(raw)?.messages).toHaveLength(1);
    expect(reconcileSwayChatModel("gone", [{ id: "keep", name: "Keep", provider: "test" }])).toBe("keep");
  });

  test("normalizes persisted streaming assistants to interrupted errors without dropping stream state", () => {
    const raw = JSON.stringify({ schemaVersion: 1, model: "test", systemPrompt: "", messages: [
      { id: "u", role: "user", content: "hello" },
      { id: "a", role: "assistant", content: "partial", status: "streaming", startAt: 9_000, thinking: "reasoning", streamUsage: { prompt: 12, completion: 4, reasoning: 3 }, ttfbMs: 100, thoughtMs: 80 },
    ] });
    const parsed = parseSwayChatWorkspace(raw, 10_000);
    expect(parsed?.messages[1]).toMatchObject({ id: "a", content: "partial", status: "error", interrupted: true, startAt: 9_000, durationMs: 1_000, thinking: "reasoning", ttfbMs: 100, thoughtMs: 80, streamUsage: { prompt: 12, completion: 4, reasoning: 3 } });
  });

  test("drops legacy tool turns from restored workspaces", () => {
    const raw = JSON.stringify({ schemaVersion: 1, model: "test", systemPrompt: "", messages: [
      { id: "u", role: "user", content: "hello" },
      { id: "legacy-tool", role: "tool", content: "{\"result\":4}" },
      { id: "a", role: "assistant", content: "hi", toolCalls: [{ id: "call_1", name: "calculator", arguments: "{}", status: "done" }] },
    ] });
    expect(parseSwayChatWorkspace(raw)?.messages).toEqual([
      expect.objectContaining({ id: "u", role: "user" }),
      expect.objectContaining({ id: "a", role: "assistant" }),
    ]);
  });

  test("bounds malformed/future timestamps, durations, and elapsed timers", () => {
    expect(normalizeChatTimestamp(50_000, 10_000)).toBe(10_000);
    expect(normalizeChatTimestamp(-1, 10_000)).toBeUndefined();
    expect(normalizeChatDuration(-1)).toBeUndefined();
    expect(normalizeChatDuration(MAX_CHAT_DURATION_MS + 1)).toBe(MAX_CHAT_DURATION_MS);
    expect(elapsedChatDuration(20_000, 10_000)).toBe(0);
    expect(elapsedChatDuration(0, MAX_CHAT_DURATION_MS * 3)).toBe(MAX_CHAT_DURATION_MS);
    expect(normalizePersistedAssistantMessage(am("done"))).toMatchObject({ status: "done" });
  });
});

describe("A7.1 Model Studio engine — request building", () => {
  test("buildRequestMessages prefixes system + serializes plain turns", () => {
    const h = [um("hi"), am("hello"), um("again")];
    const out = buildRequestMessages(h, "Be terse.");
    expect(out[0]).toEqual({ role: "system", content: "Be terse." });
    expect(out[1]).toEqual({ role: "user", content: "hi" });
    expect(out[2]).toEqual({ role: "assistant", content: "hello" });
    expect(out[3]).toEqual({ role: "user", content: "again" });
  });

  test("user turns with attachments become multi-part vision content", () => {
    const h = [
      um("describe this", {
        attachments: [
          { id: "a1", name: "pic.png", size: 100, url: "data:image/png;base64,AAAA", mime: "image/png" },
        ],
      }),
    ];
    const out = buildRequestMessages(h, "");
    expect(Array.isArray(out[0].content)).toBe(true);
    const parts = out[0].content as Array<{ type: string; text?: string; image_url?: unknown }>;
    expect(parts[0]).toEqual({ type: "text", text: "describe this" });
    expect(parts[1].type).toBe("image_url");
  });

  test("deleted and error turns are excluded", () => {
    const h = [um("keep"), um("gone", { deleted: true }), am("broken", { status: "error" })];
    const out = buildRequestMessages(h, "");
    expect(out.length).toBe(1);
    expect((out[0] as { content: string }).content).toBe("keep");
  });

  test("appends ephemeral assistant tool calls and tool results after chat history", () => {
    const out = buildRequestMessages([um("check status")], "Be useful.", [
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "router_overview", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "{\"ok\":true}" },
    ]);
    expect(out.at(-2)).toMatchObject({ role: "assistant", tool_calls: [{ id: "call_1" }] });
    expect(out.at(-1)).toEqual({ role: "tool", tool_call_id: "call_1", content: "{\"ok\":true}" });
  });

});

describe("A7.1 Model Studio engine — compaction", () => {
  test("shouldCompact false under threshold, true over 80%", () => {
    const tiny = um("x".repeat(40));
    expect(shouldCompact([tiny], "", 10_000, 0.8)).toBe(false);
    const big = um("y".repeat(40_000));
    expect(shouldCompact([big], "", 10_000, 0.8)).toBe(true);
  });

  test("compactHistory culls oldest turns to fit under 80% and marks them deleted", () => {

    const turns: ChatMessage[] = [];
    for (let i = 0; i < 20; i++) {
      turns.push(um(`turn-${i}-${"z".repeat(4000)}`));
      turns.push(am("ack-" + "k".repeat(4000)));
    }
    const before = estimateTokens(turns);
    expect(before).toBeGreaterThan(20_000);

    const compacted = compactHistory(turns, "", 20_000, 0.8);
    const after = estimateTokens(compacted);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(16_000);

    expect(compacted.length).toBe(turns.length);
    const deleted = compacted.filter((m) => m.deleted);
    expect(deleted.length).toBeGreaterThan(0);

    const nonDeleted = compacted.filter((m) => !m.deleted);
    expect(nonDeleted[nonDeleted.length - 1].role).toBe("assistant");
  });

  test("compactHistory is a no-op when already under budget", () => {
    const h = [um("small")];
    const out = compactHistory(h, "", 100_000, 0.8);
    expect(out).toBe(h);
  });
});

describe("A7.1 Model Studio engine — SSE parsing", () => {
  test("readAssistantText handles OpenAI delta/string and Responses output_text", () => {
    expect(readAssistantText({ choices: [{ delta: { content: "hi" } }] })).toBe("hi");
    expect(readAssistantText({ choices: [{ delta: { content: ["x"] } }] })).toBe("x");
    expect(readAssistantText({ output_text: "resp" })).toBe("resp");
    expect(readAssistantText({})).toBe("");
  });

  test("readAssistantThinking reads reasoning_content + thinking aliases", () => {
    expect(readAssistantThinking({ choices: [{ delta: { reasoning_content: "why" } }] })).toBe("why");
    expect(readAssistantThinking({ thinking: "hmm" })).toBe("hmm");
    expect(readAssistantThinking({ delta: { thinking: "hmm2" } })).toBe("hmm2");
    expect(readAssistantThinking({})).toBe("");
  });

  test("readStreamUsage maps OpenAI usage + reasoning_tokens", () => {
    const u = readStreamUsage({
      usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 } },
    });
    expect(u).toEqual({ prompt: 10, completion: 5, reasoning: 2, cached: undefined, cacheCreation: undefined });
    expect(readStreamUsage({ usage: { input_tokens: 20, output_tokens: 8, input_tokens_details: { cached_tokens: 12 }, cache_creation_input_tokens: 4 } })).toEqual({ prompt: 20, completion: 8, reasoning: undefined, cached: 12, cacheCreation: 4 });
    expect(readStreamUsage({ usage: {} })).toBeNull();
    expect(readStreamUsage({})).toBeNull();
  });

});

describe("A7.1 Model Studio engine — misc", () => {
  test("adds authoritative runtime model context to the system prompt", () => {
    const prompt = buildModelAwareSystemPrompt("You are Sway Router.", "custom-provider/zai-org/GLM-5.2");
    expect(prompt).toContain("Active model ID: custom-provider/zai-org/GLM-5.2");
    expect(prompt).toContain("Provider: custom-provider");
    expect(prompt).toContain("Model name: GLM-5.2");
    expect(prompt).toContain("never guess from writing style or capabilities");
  });

  test("groupModels groups + filters A–Z by provider", () => {
    const models: ModelInfo[] = [
      { id: "zeta/z-1", name: "Z", provider: "zeta" },
      { id: "alpha/a-1", name: "A1", provider: "alpha" },
      { id: "alpha/a-2", name: "A2", provider: "alpha" },
    ];
    const g = groupModels(models, "a2");
    expect(g.length).toBe(1);
    expect(g[0].provider).toBe("alpha");
    expect(g[0].items.length).toBe(1);

    const all = groupModels(models, "");
    expect(all.map((x) => x.provider)).toEqual(["alpha", "zeta"]);
  });

  test("isAcceptedImage + formatDuration + createId shape (2MB per-file, 4MB payload, 4 max)", () => {
    expect(MAX_IMAGE_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_IMAGE_PAYLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_IMAGES_PER_MSG).toBe(4);
    const ok = { type: "image/png", size: 100 } as File;
    const tooBig = { type: "image/png", size: MAX_IMAGE_BYTES + 1 } as File;
    const badMime = { type: "application/pdf", size: 100 } as File;
    expect(isAcceptedImage(ok)).toBe(true);
    expect(isAcceptedImage(tooBig)).toBe(false);
    expect(isAcceptedImage(badMime)).toBe(false);
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(2500)).toBe("2.5s");
    expect(formatDuration(7 * 60_000 + 52_300)).toBe("7m 52.3s");
    expect(formatThinkingDuration(MAX_VISIBLE_THINKING_MS + 1)).toBe("30m 0.0s+");
    expect(formatDuration(-1)).toBe("—");
    expect(formatTokenCount(2013)).toBe("2,013");
    expect(formatTokenCount(0)).toBe("0");
    expect(formatTokenCount(undefined)).toBe("—");
    expect(getThinkingPhase({ thinking: "reasoning" })).toBe("Thinking");
    expect(getThinkingPhase({ content: "answer" })).toBe("Writing");
    expect(getThinkingPhase({})).toBe("Thinking");
    const id = createId();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(createId()).not.toBe(id);
  });
});
