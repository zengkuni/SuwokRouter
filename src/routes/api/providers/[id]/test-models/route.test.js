import { describe, expect, test } from "bun:test";
import { mergeCustomModels } from "./route.js";

describe("provider model test catalog", () => {
  test("includes matching custom models without duplicating static models", () => {
    const routeModel = (id) => String(id).startsWith("gcli/") ? id : `gcli/${id}`;
    const models = mergeCustomModels(
      [{ id: "grok-4.5", name: "Grok 4.5" }],
      [
        { providerAlias: "grok-cli", id: "gcli/grok-4.6", name: "Grok 4.6", type: "llm" },
        { providerAlias: "grok-cli", id: "grok-4.5", name: "Duplicate", type: "llm" },
        { providerAlias: "grok-cli", id: "grok-vision", name: "Vision", type: "image" },
        { providerAlias: "meta", id: "meta-model", name: "Other provider", type: "llm" },
      ],
      new Set(["grok-cli", "gcli"]),
      "gcli",
      routeModel,
    );

    expect(models.map((model) => model.id)).toEqual(["grok-4.5", "gcli/grok-4.6"]);
  });
});
