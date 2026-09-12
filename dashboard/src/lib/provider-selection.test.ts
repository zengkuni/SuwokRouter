import { describe, expect, test } from "bun:test";
import { providerSelectionChanged } from "./provider-selection";

describe("provider selection", () => {
  test("does not reset state when the active provider is clicked again", () => {
    expect(providerSelectionChanged("openai-codex", "openai-codex")).toBe(false);
  });

  test("resets state only when the provider changes", () => {
    expect(providerSelectionChanged("openai-codex", "meta")).toBe(true);
    expect(providerSelectionChanged(null, "meta")).toBe(true);
  });
});
