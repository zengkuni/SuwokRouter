import { describe, expect, test } from "bun:test";
import { stripKnownModelPrefix } from "./route.js";

describe("public model id normalization", () => {
  test("removes provider prefixes from custom model ids", () => {
    expect(stripKnownModelPrefix("gcli/grok-4.6", ["gcli", "grok-cli"])).toBe("grok-4.6");
    expect(stripKnownModelPrefix("grok-cli/gcli/grok-4.6", ["gcli", "grok-cli"])).toBe("grok-4.6");
  });

  test("keeps provider-native model ids unchanged", () => {
    expect(stripKnownModelPrefix("grok-4.5-high", ["gcli", "grok-cli"])).toBe("grok-4.5-high");
  });
});
