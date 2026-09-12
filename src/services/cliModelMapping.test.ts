import { describe, expect, test } from "bun:test";
import {
  normalizeCliModelMappings,
  resolveCliModelMapping,
  clientToolId,
} from "./cliModelMapping.js";

describe("CLI model mappings", () => {
  test("resolves exact per-tool mapping and leaves unknown tools unchanged", () => {
    const mappings = {
      codex: { enabled: true, entries: [{ sourceModel: "gpt-5", targetModel: "openai/gpt-5.6" }] },
    };
    expect(resolveCliModelMapping("codex", "gpt-5", mappings)).toBe("openai/gpt-5.6");
    expect(resolveCliModelMapping("codex", "gpt-4", mappings)).toBe("gpt-4");
    expect(resolveCliModelMapping("claude", "gpt-5", mappings)).toBe("gpt-5");
  });

  test("supports Claude family matching but exact match wins", () => {
    const mappings = {
      claude: {
        enabled: true,
        entries: [
          { sourceModel: "claude-sonnet", targetModel: "anthropic/sonnet-target" },
          { sourceModel: "claude-sonnet-4.6", targetModel: "anthropic/exact-target" },
        ],
      },
    };
    expect(resolveCliModelMapping("claude_code", "claude-sonnet-4.6", mappings)).toBe("anthropic/exact-target");
    expect(resolveCliModelMapping("claude", "claude-sonnet-5", mappings)).toBe("anthropic/sonnet-target");
  });

  test("disabled snapshots and entries are ignored", () => {
    const mappings = normalizeCliModelMappings({
      codex: { enabled: false, entries: [{ sourceModel: "gpt-5", targetModel: "x" }] },
      opencode: { entries: [{ sourceModel: "a", targetModel: "b", enabled: false }] },
    });
    expect(resolveCliModelMapping("codex", "gpt-5", mappings)).toBe("gpt-5");
    expect(resolveCliModelMapping("opencode", "a", mappings)).toBe("a");
  });

  test("normalizes legacy snake-case fields", () => {
    expect(clientToolId("github-copilot")).toBe("copilot");
    expect(normalizeCliModelMappings({ x: { entries: [{ source_model: "a", target_model: "b" }] } })).toEqual({
      x: { enabled: true, entries: [{ sourceModel: "a", targetModel: "b", enabled: true }] },
    });
  });
});
