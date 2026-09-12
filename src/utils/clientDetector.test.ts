import { describe, expect, test, beforeEach } from "bun:test";
import {
  detectClient,
  detectClientTool,
  isNativePassthrough,
  NATIVE_PAIRS,
} from "./clientDetector.js";
import {
  detectClientFormat,
  clientToFormat,
} from "../translator/detection.js";
import { FORMATS } from "../translator/formats.js";
import { __resetMetricsForTests } from "../observability/metrics.js";

beforeEach(() => __resetMetricsForTests());

describe("A4.5 client detection: header/UA channel", () => {
  test("claude via x-app + UA", () => {
    const v = detectClient({ "user-agent": "claude-cli/1.0", "x-app": "cli" }, {});
    expect(v.id).toBe("claude");
    expect(v.confidence === "low" || v.confidence === "medium" || v.confidence === "high").toBe(true);
  });
  test("codex via UA codex-tui", () => {
    expect(detectClient({ "user-agent": "codex-tui/0.0" }, {}).id).toBe("codex");
  });
  test("cursor via UA", () => {
    expect(detectClient({ "user-agent": "cursor/0.42" }, {}).id).toBe("cursor");
  });
  test("gemini-cli via UA", () => {
    expect(detectClient({ "user-agent": "gemini-cli/0.1" }, {}, { path: "/v1/models" }).id).toBe("gemini-cli");
  });
  test("antigravity via body userAgent + path", () => {
    const v = detectClient({}, { userAgent: "antigravity" });
    expect(v.id).toBe("antigravity");
  });
  test("github-copilot via openai-intent", () => {
    expect(detectClient({ "openai-intent": "conversation-panel" }, {}).id).toBe("github-copilot");
  });
  test("cline via UA", () => {
    expect(detectClient({ "user-agent": "cline/1.2" }, {}).id).toBe("cline");
  });
  test("kiro via UA", () => {
    expect(detectClient({ "user-agent": "kiro/1.0" }, {}).id).toBe("kiro");
  });
  test("hermes via UA", () => {
    expect(detectClient({ "user-agent": "hermes/3.0 nous" }, {}).id).toBe("hermes");
  });
  test("opencode via UA", () => {
    expect(detectClient({ "user-agent": "opencode/0.1" }, {}).id).toBe("opencode");
  });
  test("deepseek-tui via UA", () => {
    expect(detectClient({ "user-agent": "deepseek-tui/0.1" }, {}).id).toBe("deepseek-tui");
  });
});

describe("A4.5 client detection: body-shape channel", () => {
  test("claude via anthropic_version", () => {
    expect(detectClient({}, { anthropic_version: "2023-06-01", messages: [{ role: "user", content: "hi" }] }).id).toBe("claude");
  });
  test("codex via responses input[] (no messages)", () => {
    expect(detectClient({}, { input: [{ role: "user", content: "x" }] }).id).toBe("codex");
  });
  test("gemini-cli via contents[]", () => {
    expect(detectClient({}, { contents: [{ role: "user", parts: [{ text: "hi" }] }] }).id).toBe("gemini-cli");
  });
});

describe("A4.5 client detection: prompt markers channel", () => {
  test("claude via system prompt self-id", () => {
    const v = detectClient({}, {
      messages: [
        { role: "system", content: "You are Claude Code, Anthropic's official CLI." },
        { role: "user", content: "hi" },
      ],
    });
    expect(v.id).toBe("claude");
  });
  test("codex via prompt marker", () => {
    expect(detectClient({}, {
      messages: [{ role: "system", content: "You are Codex, OpenAI's coding agent." }],
    }).id).toBe("codex");
  });
  test("cline via prompt marker", () => {
    expect(detectClient({}, {
      messages: [{ role: "system", content: "You are Cline, your coding agent." }],
    }).id).toBe("cline");
  });
  test("prompt marker lowercase + array content", () => {
    expect(detectClient({}, {
      messages: [
        { role: "system", content: [{ type: "text", text: "YOU ARE CLAUDE CODE." }] },
        { role: "user", content: "hi" },
      ],
    }).id).toBe("claude");
  });
  test("irrelevant prompt (no marker) → null from prompt channel only; header still wins", () => {
    const v = detectClient({ "user-agent": "claude-cli/1.0" }, {
      messages: [{ role: "user", content: "just a normal question" }],
    });
    expect(v.id).toBe("claude");
  });
});

describe("A4.5 client detection: multi-signal resolution + conflict", () => {
  test("claude all cues agree → high confidence, no conflicts", () => {
    const v = detectClient(
      { "user-agent": "claude-cli/1.0", "x-app": "cli" },
      { anthropic_version: "2023-06-01", messages: [{ role: "system", content: "You are Claude Code" }] },
      { path: "/v1/messages" },
    );
    expect(v.id).toBe("claude");
    expect(v.confidence).toBe("high");
    expect(v.conflicts.length).toBe(0);
    expect(v.agrees).toBeGreaterThanOrEqual(3);
  });
  test("conflict surfaces when header says X but body says Y", () => {

    const v = detectClient(
      { "user-agent": "claude-cli/1.0" },
      { input: [{ role: "user", content: "x" }] },
    );

    expect(v.conflicts.length).toBeGreaterThanOrEqual(1);

    expect(v.id).not.toBeNull();
  });
  test("no signal at all → id null, confidence low", () => {
    const v = detectClient({}, {});
    expect(v.id).toBeNull();
    expect(v.confidence).toBe("low");
    expect(v.signals).toBe(0);
  });
});

describe("A4.5 client detection: coverage ≥10", () => {
  test("≥10 distinct client ids resolvable + re-exported", () => {
    const ids = new Set<string | null>([
      detectClient({ "user-agent": "claude-cli/1.0" }, {}).id,
      detectClient({ "user-agent": "codex-tui/0.0" }, {}).id,
      detectClient({ "user-agent": "gemini-cli/0.1" }, {}).id,
      detectClient({}, { userAgent: "antigravity" }).id,
      detectClient({ "openai-intent": "conversation-panel" }, {}).id,
      detectClient({ "user-agent": "cursor/0.42" }, {}).id,
      detectClient({ "user-agent": "cline/1.2" }, {}).id,
      detectClient({ "user-agent": "kiro/1.0" }, {}).id,
      detectClient({ "user-agent": "hermes/3.0 nous" }, {}).id,
      detectClient({ "user-agent": "opencode/0.1" }, {}).id,
      detectClient({ "user-agent": "deepseek-tui/0.1" }, {}).id,
    ]);

    expect(ids.has(null)).toBe(false);
    expect(ids.size).toBeGreaterThanOrEqual(10);
  });
  test("NATIVE_PAIRS covers the passthrough-eligible client set", () => {
    expect(NATIVE_PAIRS["claude"]).toContain("anthropic");
    expect(NATIVE_PAIRS["codex"]).toContain("codex");
    expect(NATIVE_PAIRS["cursor"]).toContain("cursor");
    expect(NATIVE_PAIRS["kiro"]).toContain("kiro");
    expect(NATIVE_PAIRS["hermes"]).toContain("hermes");
  });
});

describe("A4.5 client detection: backward-compat surface", () => {
  test("detectClientTool returns string id (same as old contract)", () => {
    expect(detectClientTool({ "user-agent": "claude-cli/1.0" }, {})).toBe("claude");
    expect(detectClientTool({}, { userAgent: "antigravity" })).toBe("antigravity");
    expect(detectClientTool({}, {})).toBeNull();
  });
  test("isNativePassthrough: claude → anthropic true; claude → openai false", () => {
    expect(isNativePassthrough("claude", "anthropic")).toBe(true);
    expect(isNativePassthrough("claude", "claude")).toBe(true);
    expect(isNativePassthrough("claude", "openai")).toBe(false);
    expect(isNativePassthrough(null, "anthropic")).toBe(false);
    expect(isNativePassthrough("aider", "openai")).toBe(false);
  });
  test("isNativePassthrough anthropic-compatible-* aliases to anthropic", () => {
    expect(isNativePassthrough("claude", "anthropic-compatible-anything")).toBe(true);
  });
});

describe("A4.5 client detection: translator facade (detection.js)", () => {
  test("clientToFormat maps every resolvable client to a FORMATS key", () => {
    expect(clientToFormat("claude")).toBe(FORMATS.CLAUDE);
    expect(clientToFormat("gemini-cli")).toBe(FORMATS.GEMINI_CLI);
    expect(clientToFormat("antigravity")).toBe(FORMATS.ANTIGRAVITY);
    expect(clientToFormat("codex")).toBe(FORMATS.CODEX);
    expect(clientToFormat("cursor")).toBe(FORMATS.CURSOR);
    expect(clientToFormat("kiro")).toBe(FORMATS.KIRO);

    expect(clientToFormat("github-copilot")).toBe(FORMATS.OPENAI);
    expect(clientToFormat("cline")).toBe(FORMATS.OPENAI);
    expect(clientToFormat(null)).toBe(FORMATS.OPENAI);
  });
  test("detectClientFormat returns view + format together", () => {
    const r = detectClientFormat({ "user-agent": "claude-cli/1.0" }, {});
    expect(r.id).toBe("claude");
    expect(r.format).toBe(FORMATS.CLAUDE);
    expect(typeof r.confidence).toBe("string");
    expect(Array.isArray(r.conflicts)).toBe(true);
  });
});
