import { describe, expect, test } from "bun:test";
import { supportsGrokCliReasoningEffort } from "./grokCli.js";

describe("Grok CLI reasoning support", () => {
  test("accepts reasoning levels for Grok 4 model variants", () => {
    expect(supportsGrokCliReasoningEffort("grok-4.5")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-4.6")).toBe(true);
    expect(supportsGrokCliReasoningEffort("grok-4.6-high")).toBe(true);
  });

  test("does not assume reasoning support for Grok Build", () => {
    expect(supportsGrokCliReasoningEffort("grok-build")).toBe(false);
  });
});
