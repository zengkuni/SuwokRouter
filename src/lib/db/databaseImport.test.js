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
    db.run("DELETE FROM apiKeys WHERE name = ?", [TEST_KEY_NAME]);
    const created = await createApiKey(TEST_KEY_NAME, "production-import-test-machine");
    const payload = await exportDb();
    expect(payload.product).toBe("swayrouter");
    expect(payload.apiKeysRedacted).toBe(true);
    expect(payload.apiKeys.every((key) => !Object.prototype.hasOwnProperty.call(key, "key"))).toBe(true);

    await importDb({ ...payload, apiKeysRedacted: true });
    const restored = db.get("SELECT key, name FROM apiKeys WHERE id = ?", [created.id]);
    expect(restored?.key).toBeTruthy();
    expect(restored?.name).toBe(TEST_KEY_NAME);
    db.run("DELETE FROM apiKeys WHERE id = ?", [created.id]);
  });

  test("rejects API-key metadata without secret material", async () => {
    await expect(importDb({ apiKeys: [{ id: "missing-secret" }] })).rejects.toThrow("API key material");
  });
});
