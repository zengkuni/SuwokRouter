import { describe, expect, test } from "bun:test";
import { generateApiKeyWithMachine, parseApiKey } from "./apiKey.js";

describe("gateway API key format", () => {
  test("generates Sway keys with the swy prefix", () => {
    const generated = generateApiKeyWithMachine("machine1");

    expect(generated.key.startsWith("swy-machine1-")).toBe(true);
    expect(parseApiKey(generated.key)).toEqual({
      machineId: "machine1",
      keyId: generated.keyId,
      isNewFormat: true,
    });
  });

  test("continues accepting legacy sws keys", () => {
    const generated = generateApiKeyWithMachine("machine1");
    const legacyKey = generated.key.replace(/^swy-/, "sws-");

    expect(parseApiKey(legacyKey)).toEqual({
      machineId: "machine1",
      keyId: generated.keyId,
      isNewFormat: true,
    });
  });
});
