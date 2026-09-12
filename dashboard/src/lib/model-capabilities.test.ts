import { describe, expect, test } from "bun:test";
import {
  mergeModelRows,
  normalizeModelCapabilities,
  normalizeProviderModelId,
  normalizeProviderModelRows,
  trueModelCapabilities,
  type ModelRow,
} from "@/lib/model-capabilities";

describe("model capabilities", () => {
  test("normalizes boolean and limit fields", () => {
    expect(normalizeModelCapabilities({ vision: true, tools: false, contextWindow: "200000", nope: true })).toEqual({ vision: true, tools: false, contextWindow: 200000 });
  });

  test("returns only explicitly supported badges", () => {
    expect(trueModelCapabilities({ vision: true, pdf: false, reasoning: true })).toEqual([
      { key: "vision", label: "Vision" },
      { key: "reasoning", label: "Reasoning" },
    ]);
    expect(trueModelCapabilities()).toEqual([]);
  });

  test("normalizes a live catalog without losing rows or metadata", () => {
    const raw: unknown[] = Array.from({ length: 58 }, (_, index) => ({
      id: `custom-provider/model-${index}`,
      name: `Model ${index}`,
      capabilities: index === 0 ? { vision: true, tools: true } : undefined,
    }));
    raw.push(null, {}, { id: "" }, { model: "custom-provider/model-from-model-key", caps: { pdf: true } });
    const rows = normalizeProviderModelRows(raw);
    expect(rows).toHaveLength(59);
    expect(rows[0]).toMatchObject({ id: "custom-provider/model-0", caps: { vision: true, tools: true } });
    expect(rows.at(-1)).toMatchObject({ id: "custom-provider/model-from-model-key", caps: { pdf: true } });
  });

  test("canonicalizes ClinePass legacy and routed IDs into one row", () => {
    expect(normalizeProviderModelId("cline-pass/glm-5.2", "clinepass")).toBe("clinepass/glm-5.2");
    expect(normalizeProviderModelId("clinepass/cline-pass/glm-5.2", "clinepass")).toBe("clinepass/glm-5.2");
    expect(mergeModelRows([
      { id: "cline-pass/glm-5.2", name: "legacy" },
      { id: "clinepass/cline-pass/glm-5.2", name: "catalog", caps: { reasoning: true } },
    ], "clinepass")).toEqual([
      { id: "clinepass/glm-5.2", name: "legacy", caps: { reasoning: true } },
    ]);
  });

  test("merges duplicate rows and keeps capability metadata", () => {
    const rows: ModelRow[] = [
      { id: "x/model", name: "Model", caps: { vision: true } },
      { id: "x/model", name: "", caps: { reasoning: true } },
      { id: "custom", name: "custom" },
    ];
    expect(mergeModelRows(rows)).toEqual([
      { id: "x/model", name: "Model", caps: { reasoning: true, vision: true } },
      { id: "custom", name: "custom" },
    ]);
  });

  test("retains custom-only rows when live data is present", () => {
    expect(mergeModelRows([
      { id: "upstream/model", name: "Upstream" },
      { id: "saved/model", name: "Saved" },
    ])).toEqual([
      { id: "upstream/model", name: "Upstream" },
      { id: "saved/model", name: "Saved" },
    ]);
  });
});
