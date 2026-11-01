import { describe, expect, test, beforeEach } from "bun:test";

// Wiring regression test: chatCore must apply the resolved prompt-injection
// stack onto the translated body BEFORE the provider executor runs, and must
// stay fail-open when the injection store errors.
//
// handleChatCore exposes its side-effecting boundaries as optional parameters
// (resolveInjectionsDep / resolveKeyIdDep / getExecutorDep / trackPendingDep /
// appendReqLogDep / saveDetailDep). The test injects fakes through that seam —
// no global module mocks, no database writes, no upstream network calls.

const MARKER = "PINJECT_E2E_MARKER_7f3a";

let resolveResult = [];
let resolveShouldThrow = false;
let capturedBody = null;
let executeCalls = 0;

const { handleChatCore } = await import("./chatCore.js");

function runChat() {
  return handleChatCore({
    body: {
      model: "openai/gpt-4o",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
    modelInfo: { provider: "openai", model: "gpt-4o", modelCapabilities: {} },
    credentials: { connectionId: "conn-test", apiKey: "sk-test", providerSpecificData: {} },
    log: null,
    resolveKeyIdDep: async () => "key-test",
    // mirror selectPromptInjections: disabled entries never reach chatCore
    resolveInjectionsDep: async () => {
      if (resolveShouldThrow) throw new Error("store unavailable");
      return resolveResult.filter((e) => e && e.enabled);
    },
    getExecutorDep: () => ({
      noAuth: true,
      execute: async (opts) => {
        executeCalls += 1;
        capturedBody = opts.body;
        throw new Error("MOCK_EXECUTOR_STOP");
      },
    }),
    trackPendingDep: () => {},
    appendReqLogDep: async () => {},
    saveDetailDep: async () => {},
  });
}

const systemTexts = (body) =>
  (body?.messages ?? [])
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));

describe("chatCore prompt-injection wiring", () => {
  beforeEach(() => {
    resolveResult = [];
    resolveShouldThrow = false;
    capturedBody = null;
    executeCalls = 0;
  });

  test("single-mode injection reaches the executor body", async () => {
    resolveResult = [
      { mode: "single", text: MARKER, position: "append", name: "global", enabled: true },
    ];
    await runChat();
    expect(executeCalls).toBe(1);
    expect(systemTexts(capturedBody).join("\n")).toContain(MARKER);
  });

  test("chat-mode injection reaches the executor body as turns", async () => {
    resolveResult = [
      {
        mode: "chat",
        name: "global",
        enabled: true,
        position: "append",
        turns: [{ role: "user", content: MARKER }],
      },
    ];
    await runChat();
    expect(executeCalls).toBe(1);
    const contents = (capturedBody?.messages ?? []).map((m) => String(m.content));
    expect(contents.join("\n")).toContain(MARKER);
  });

  test("disabled injection is not applied", async () => {
    resolveResult = [
      { mode: "single", text: MARKER, position: "append", name: "global", enabled: false },
    ];
    await runChat();
    expect(executeCalls).toBe(1);
    expect(systemTexts(capturedBody).join("\n")).not.toContain(MARKER);
  });

  test("store failure stays fail-open: request still reaches the executor", async () => {
    resolveResult = [
      { mode: "single", text: MARKER, position: "append", name: "global", enabled: true },
    ];
    resolveShouldThrow = true;
    const result = await runChat();
    expect(executeCalls).toBe(1);
    expect(systemTexts(capturedBody).join("\n")).not.toContain(MARKER);
    // the 502 comes from the executor throwing (gateway error), not from the
    // injection store failure — a store error must never fail the request
    expect(result.status).toBe(502);
    expect(result.error).toBeTruthy();
  });
});
