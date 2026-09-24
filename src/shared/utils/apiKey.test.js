import { describe, expect, test } from "bun:test";
import { generateApiKeyWithMachine, parseApiKey } from "./apiKey.js";

describe("gateway API key format", () => {
  test("generates Suwok keys with the suw prefix", () => {
    const generated = generateApiKeyWithMachine("machine1");

    expect(generated.key.startsWith("suw-machine1-")).toBe(true);
    expect(parseApiKey(generated.key)).toEqual({
      machineId: "machine1",
      keyId: generated.keyId,
      isNewFormat: true,
    });
  });

  test("continues accepting pre-rebrand swy keys", () => {
    const generated = generateApiKeyWithMachine("machine1");
    const rebrandedKey = generated.key.replace(/^suw-/, "swy-");

    expect(parseApiKey(rebrandedKey)).toEqual({
      machineId: "machine1",
      keyId: generated.keyId,
      isNewFormat: true,
    });
  });

  test("continues accepting legacy sws keys", () => {
    const generated = generateApiKeyWithMachine("machine1");
    const legacyKey = generated.key.replace(/^suw-/, "sws-");

    expect(parseApiKey(legacyKey)).toEqual({
      machineId: "machine1",
      keyId: generated.keyId,
      isNewFormat: true,
    });
  });
});
