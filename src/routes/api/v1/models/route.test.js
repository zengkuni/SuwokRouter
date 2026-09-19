import { describe, expect, mock, test } from "bun:test";

const localDb = await import("@/lib/localDb");
mock.module("@/lib/localDb", () => ({
  ...localDb,
  getActiveProviderRows: async () => [],
  getCombos: async () => [],
  getCustomModels: async () => [],
}));

const disabledModelsDb = await import("@/lib/disabledModelsDb");
mock.module("@/lib/disabledModelsDb", () => ({
  ...disabledModelsDb,
  getDisabledModels: async () => ({}),
}));

const { buildModelsList, stripKnownModelPrefix } = await import("./route.js");

describe("public model id normalization", () => {
  test("removes provider prefixes from custom model ids", () => {
    expect(stripKnownModelPrefix("gcli/grok-4.6", ["gcli", "grok-cli"])).toBe("grok-4.6");
    expect(stripKnownModelPrefix("grok-cli/gcli/grok-4.6", ["gcli", "grok-cli"])).toBe("grok-4.6");
  });

  test("keeps provider-native model ids unchanged", () => {
    expect(stripKnownModelPrefix("grok-4.5-high", ["gcli", "grok-cli"])).toBe("grok-4.5-high");
  });
});

describe("GET /v1/models", () => {
  test("includes OpenCode Free models without a provider connection", async () => {
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    const openCodeModels = models.filter((model) => model.owned_by === "oc");

    expect(openCodeModels.length).toBeGreaterThan(0);
    expect(openCodeModels.some((model) => model.id === "oc/muse-spark-1.3-contributor-free")).toBe(true);
  });
});
