import { describe, expect, test } from "bun:test";
import { mergeApiKeyUpdate } from "./apiKeysRepo.js";

describe("api key updates", () => {
  test("preserves the secret for partial active-state updates", () => {
    const result = mergeApiKeyUpdate({
      key: "sws-existing-secret",
      name: "Backend",
      machineId: "machine-1",
      isActive: 1,
    }, { isActive: false });

    expect(result).toEqual({
      key: "sws-existing-secret",
      name: "Backend",
      machineId: "machine-1",
      isActive: false,
    });
  });
});
