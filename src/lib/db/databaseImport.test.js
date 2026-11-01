import { describe, expect, test } from "bun:test";
import { exportDb, importDb, validateDatabaseBackup } from "./index.js";
import { getAdapter } from "./driver.js";
import { createApiKey } from "./repos/apiKeysRepo.js";

const TEST_KEY_NAME = "production-import-regression";

describe("database export/import", () => {
  const configurationBackup = {
    formatVersion: 1,
    backupScope: "configuration",
    settings: {},
    providerConnections: [{ id: "connection-1", provider: "cursor", authType: "oauth" }],
    providerNodes: [],
    proxyPools: [],
    apiKeysRedacted: true,
    apiKeys: [],
    combos: [],
    customModels: [],
    pricing: {},
  };

  test("rejects malformed configuration before any replace can run", () => {
    expect(() => validateDatabaseBackup({ ...configurationBackup, providerConnections: [{ id: "connection-1" }] }))
      .toThrow("providerConnections[0].provider is required");
    expect(() => validateDatabaseBackup({ ...configurationBackup, usageHistory: [] }))
      .toThrow("usage data requires backupScope 'full'");
  });

  test("redirects 9Router backups to the dedicated migrator", () => {
    expect(() => validateDatabaseBackup({
      settings: {},
      providerConnections: [],
      providerNodes: [],
      proxyPools: [],
      apiKeys: [],
      combos: [],
      modelAliases: {},
      customModels: [],
      mitmAlias: null,
      pricing: {},
    })).toThrow("9Router backups must use Migrate from 9Router");
  });

  test("requires complete full-data sections and numeric usage IDs", () => {
    const fullBackup = {
      ...configurationBackup,
      backupScope: "full",
      usageHistory: [],
      usageDaily: [],
      requestDetails: [],
    };
    expect(validateDatabaseBackup(fullBackup).scope).toBe("full");
    expect(() => validateDatabaseBackup({ ...fullBackup, requestDetails: undefined }))
      .toThrow("requestDetails must be an array");
    expect(() => validateDatabaseBackup({
      ...fullBackup,
      usageHistory: [{ id: "1", timestamp: new Date().toISOString(), tokens: {}, meta: {} }],
    })).toThrow("usageHistory[0].id must be a non-negative integer");
  });

  test("secretless export preserves existing API keys", async () => {
    const db = await getAdapter();
    await db.run("DELETE FROM apiKeys WHERE name = $1", [TEST_KEY_NAME]);
    const created = await createApiKey(TEST_KEY_NAME, "production-import-test-machine");
    const payload = await exportDb();
    expect(payload.product).toBe("suwokrouter");
    expect(payload.apiKeysRedacted).toBe(true);
    expect(payload.apiKeys.every((key) => !Object.prototype.hasOwnProperty.call(key, "key"))).toBe(true);

    await importDb({ ...payload, apiKeysRedacted: true });
    const restored = await db.get("SELECT key, name FROM apiKeys WHERE id = $1", [created.id]);
    expect(restored?.key).toBeTruthy();
    expect(restored?.name).toBe(TEST_KEY_NAME);
    await db.run("DELETE FROM apiKeys WHERE id = $1", [created.id]);
  });

  test("rejects API-key metadata without secret material", async () => {
    await expect(importDb({ apiKeys: [{ id: "missing-secret" }] })).rejects.toThrow("API key material");
  });
});

describe("promptInjections backup validation", () => {
  const base = {
    formatVersion: 1,
    backupScope: "configuration",
    settings: {},
    providerConnections: [],
    providerNodes: [],
    proxyPools: [],
    apiKeysRedacted: true,
    apiKeys: [],
    combos: [],
    customModels: [],
    pricing: {},
  };

  test("accepts a well-formed promptInjections section", () => {
    expect(validateDatabaseBackup({
      ...base,
      promptInjections: {
        global: { name: "g", mode: "single", content: "hi", position: "append", enabled: true, updatedAt: null },
        byKey: { key1: { mode: "chat", turns: [{ role: "user", content: "x" }], position: "prepend", enabled: true } },
        byModel: { "gpt-combo": { mode: "single", content: "m", position: "append", enabled: false } },
        byKeyModel: { key1: { "gpt-combo": { mode: "single", content: "km", position: "append", enabled: true } } },
      },
    }).scope).toBe("configuration");
    expect(validateDatabaseBackup({ ...base, promptInjections: { global: null, byKey: {}, byModel: {}, byKeyModel: {} } }).scope)
      .toBe("configuration");
  });

  test("rejects malformed promptInjections entries", () => {
    expect(() => validateDatabaseBackup({ ...base, promptInjections: { global: { mode: "soul" } } }))
      .toThrow("promptInjections.global is not a valid injection");
    expect(() => validateDatabaseBackup({ ...base, promptInjections: { byKey: { key1: "nope" } } }))
      .toThrow("promptInjections.byKey.key1 is not a valid injection");
    expect(() => validateDatabaseBackup({ ...base, promptInjections: { byKeyModel: { key1: { m: { mode: "chat", turns: [] } } } } }))
      .toThrow("promptInjections.byKeyModel.key1.m is not a valid injection");
    expect(() => validateDatabaseBackup({ ...base, promptInjections: [] }))
      .toThrow("promptInjections must be an object");
  });
});
