import { describe, expect, test } from "bun:test";
import { injectSystemPrompt, injectChatTurns } from "./systemInject.js";
import { FORMATS } from "../translator/formats.js";
import { OPENAI_BLOCK, RESPONSES_ITEM } from "../translator/schema/blocks.js";
import { ROLE } from "../translator/schema/roles.js";

const SEP = "\n\n";
const P1 = "INJECT_PROMPT_AAA";
const P2 = "INJECT_PROMPT_BBB";

describe("systemInject chat messages[]", () => {
  test("appends to existing system string with SEP", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`base${SEP}${P1}`);
  });

  test("appends text block to system array content, never input_text", () => {
    const body = { messages: [{ role: "system", content: [{ type: OPENAI_BLOCK.TEXT, text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    const blocks = body.messages[0].content;
    expect(blocks).toHaveLength(2);
    expect(blocks[1]).toEqual({ type: "text", text: P1 });
  });

  test("unshifts typed system message when no system/developer present", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0]).toEqual({ role: ROLE.SYSTEM, content: P1 });
    expect(body.messages[1].role).toBe("user");
  });

  test("developer role counts as system", () => {
    const body = { messages: [{ role: "developer", content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`base${SEP}${P1}`);
  });

  test("prepend puts the prompt before existing content", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1, "prepend");
    expect(body.messages[0].content).toBe(`${P1}${SEP}base`);
  });

  test("prepend on missing system creates the system message", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1, "prepend");
    expect(body.messages[0]).toEqual({ role: ROLE.SYSTEM, content: P1 });
  });

  test("idempotent: identical prompt is not injected twice", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`base${SEP}${P1}`);
  });

  test("idempotency is segment-exact, not substring", () => {
    const body = { messages: [{ role: "system", content: `prefix ${P1} suffix` }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body.messages[0].content).toBe(`prefix ${P1} suffix${SEP}${P1}`);
  });

  test("a second distinct prompt still injects", () => {
    const body = { messages: [{ role: "system", content: "base" }] };
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    injectSystemPrompt(body, FORMATS.OPENAI, P2);
    expect(body.messages[0].content).toBe(`base${SEP}${P1}${SEP}${P2}`);
  });
});

describe("systemInject responses input[]", () => {
  test("appends to an existing system message content block", () => {
    const body = { input: [{ type: "message", role: "system", content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "base" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    expect(body.input[0].content[1]).toEqual({ type: RESPONSES_ITEM.INPUT_TEXT, text: P1 });
  });

  test("unshifts a typed system message when absent", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    expect(body.input[0]).toEqual({ type: "message", role: ROLE.SYSTEM, content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: P1 }] });
  });
});

describe("systemInject instructions string", () => {
  test("appends to instructions", () => {
    const body = { instructions: "base" };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    expect(body.instructions).toBe(`base${SEP}${P1}`);
  });

  test("prepend wins over append position for instructions", () => {
    const body = { instructions: "base" };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1, "prepend");
    expect(body.instructions).toBe(`${P1}${SEP}base`);
  });

  test("idempotent for instructions", () => {
    const body = { instructions: "base" };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    expect(body.instructions).toBe(`base${SEP}${P1}`);
  });
});

describe("systemInject claude", () => {
  test("appends to string system", () => {
    const body = { system: "base", messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(`base${SEP}${P1}`);
  });

  test("appends text block to system array", () => {
    const body = { system: [{ type: "text", text: "base" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toHaveLength(2);
    expect(body.system[1]).toEqual({ type: "text", text: P1 });
  });

  test("inserts before the last cache_control block", () => {
    const body = { system: [{ type: "text", text: "base" }, { type: "text", text: "cached", cache_control: { type: "ephemeral" } }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system[1]).toEqual({ type: "text", text: P1 });
    expect(body.system[2].cache_control).toBeTruthy();
  });

  test("creates system when absent", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.system).toBe(P1);
  });

  test("claude format never injects a system role into messages[]", () => {
    const body = { messages: [{ role: "user", content: "hi" }] };
    injectSystemPrompt(body, FORMATS.CLAUDE, P1);
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0].role).toBe("user");
  });
});

describe("systemInject gemini", () => {
  test("appends to system_instruction parts", () => {
    const body = { system_instruction: { parts: [{ text: "base" }] } };
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    expect(body.system_instruction.parts[1]).toEqual({ text: P1 });
  });

  test("creates systemInstruction when absent", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    injectSystemPrompt(body, FORMATS.GEMINI, P1);
    expect(body.systemInstruction).toEqual({ parts: [{ text: P1 }] });
  });

  test("antigravity request wrapper is unwrapped", () => {
    const body = { request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] } };
    injectSystemPrompt(body, FORMATS.ANTIGRAVITY, P1);
    expect(body.request.systemInstruction).toEqual({ parts: [{ text: P1 }] });
  });
});

describe("systemInject fail-open", () => {
  test("no body or no prompt is a no-op", () => {
    expect(() => injectSystemPrompt(null, FORMATS.OPENAI, P1)).not.toThrow();
    expect(() => injectSystemPrompt({}, FORMATS.OPENAI, "")).not.toThrow();
    expect(() => injectSystemPrompt("string", FORMATS.OPENAI, P1)).not.toThrow();
  });

  test("empty body with no recognizable shape is a no-op", () => {
    const body = {};
    injectSystemPrompt(body, FORMATS.OPENAI, P1);
    expect(body).toEqual({});
  });

  test("string input stays untouched", () => {
    const body = { input: "hi" };
    injectSystemPrompt(body, FORMATS.OPENAI_RESPONSES, P1);
    expect(body.input).toBe("hi");
  });
});

describe("injectChatTurns", () => {
  const turns = [
    { role: "user", content: "earlier question" },
    { role: "assistant", content: "earlier answer" },
  ];

  test("inserts turns after leading system messages in chat bodies", () => {
    const body = { messages: [{ role: "system", content: "sys" }, { role: "user", content: "real" }] };
    injectChatTurns(body, FORMATS.OPENAI, turns);
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("earlier question");
    expect(body.messages[3].content).toBe("real");
  });

  test("merges into the real first message when roles collide", () => {
    // Script block ends with a user turn, real conversation starts with user:
    // the two string contents merge (Anthropic rejects consecutive same-role).
    const body = { messages: [{ role: "user", content: "real" }] };
    injectChatTurns(body, FORMATS.OPENAI, [
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "earlier question" },
    ]);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe("assistant");
    expect(body.messages[1].content).toBe(`earlier question${SEP}real`);
  });

  test("no merge when the block ends with a different role", () => {
    const body = { messages: [{ role: "user", content: "real" }] };
    injectChatTurns(body, FORMATS.OPENAI, turns);
    expect(body.messages).toHaveLength(3);
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });
  test("idempotent: identical block at the insertion point is left alone", () => {
    const body = { messages: [{ role: "system", content: "sys" }, ...turns, { role: "user", content: "real" }] };
    injectChatTurns(body, FORMATS.OPENAI, turns);
    expect(body.messages.map((m) => m.content)).toEqual(["sys", "earlier question", "earlier answer", "real"]);
  });

  test("claude bodies get turns inside messages[], system stays in body.system", () => {
    const body = { system: "sys", messages: [{ role: "user", content: "real" }] };
    injectChatTurns(body, FORMATS.CLAUDE, turns);
    expect(body.system).toBe("sys");
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  test("gemini bodies get model role for assistant turns", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "real" }] }] };
    injectChatTurns(body, FORMATS.GEMINI, turns);
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(body.contents[0].parts[0].text).toBe("earlier question");
  });

  test("responses input[] gets typed message items", () => {
    const body = { input: [{ type: "message", role: "user", content: [{ type: RESPONSES_ITEM.INPUT_TEXT, text: "real" }] }] };
    injectChatTurns(body, FORMATS.OPENAI_RESPONSES, turns);
    expect(body.input.map((i) => i.role)).toEqual(["user", "assistant", "user"]);
    expect(body.input[0].content[0].type).toBe(RESPONSES_ITEM.INPUT_TEXT);
    expect(body.input[1].content[0].type).toBe(RESPONSES_ITEM.OUTPUT_TEXT);
  });

  test("invalid turns and empty content are dropped", () => {
    const body = { messages: [{ role: "user", content: "real" }] };
    injectChatTurns(body, FORMATS.OPENAI, [
      { role: "system", content: "nope" },
      { role: "user", content: "   " },
      { role: "assistant", content: "ok" },
    ]);
    expect(body.messages.map((m) => m.role)).toEqual(["assistant", "user"]);
  });

  test("fail-open on junk input", () => {
    expect(() => injectChatTurns(null, FORMATS.OPENAI, turns)).not.toThrow();
    expect(() => injectChatTurns({}, FORMATS.OPENAI, "nope")).not.toThrow();
    const body = { instructions: "sys" };
    injectChatTurns(body, FORMATS.OPENAI_RESPONSES, turns);
    expect(body.instructions).toBe("sys");
  });
});
