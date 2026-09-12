import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import {
  buildNineRouterMigrationPlan,
  isNineRouterBackupPayload,
  validateNineRouterPayload,
  writeNineRouterMigrationPlan,
} from "./nineRouterMigration.js";

function source(overrides = {}) {
  return {
    settings: {
      requireLogin: false,
      providerStrategies: { "codebuddy-int": { strategy: "round-robin" } },
      fallbackStrategy: "least-inflight",
    },
    providerConnections: [],
    providerNodes: [],
    proxyPools: [],
    apiKeys: [],
    combos: [],
    modelAliases: {},
    customModels: [],
    mitmAlias: null,
    pricing: {},
    ...overrides,
  };
}

const emptyCurrent = {
  settings: { requireLogin: true, profileName: "Sway Router" },
  providerConnections: [],
  providerNodes: [],
  combos: [],
  customModels: [],
};

describe("9Router migration planning", () => {
  test("recognizes 9Router exports but not Sway Router backups", () => {
    expect(isNineRouterBackupPayload(source())).toBe(true);
    expect(isNineRouterBackupPayload({ product: "swayrouter", ...source() })).toBe(false);
    expect(() => validateNineRouterPayload({ product: "swayrouter", ...source() }))
      .toThrow("not a supported 9Router backup");
  });

  test("normalizes legacy CodeBuddy, strips runtime state, and keeps accounts inactive", () => {
    const payload = source({
      providerNodes: [{
        id: "codebuddy-int",
        type: "codebuddy-int",
        name: "CodeBuddy Inter",
      }],
      providerConnections: [{
        id: "account-1",
        provider: "codebuddy-int",
        authType: "oauth",
        name: "Imported account",
        accessToken: "access-secret",
        refreshToken: "refresh-secret",
        testStatus: "success",
        backoffLevel: 3,
        modelLock_example: "locked",
        providerSpecificData: { upstreamUserAgent: "private-agent", accountId: "account-id" },
      }],
      customModels: [{
        providerAlias: "codebuddy-int",
        id: "model-a",
        type: "llm",
      }],
    });

    const result = buildNineRouterMigrationPlan(payload, {}, emptyCurrent);
    expect(result.plan.providerNodes).toHaveLength(0);
    expect(result.preview.sections.customProviders.resolved).toBe(1);
    expect(result.preview.warnings.some((warning) => warning.code === "LEGACY_PROVIDER_NORMALIZED")).toBe(false);
    expect(result.plan.providerConnections).toHaveLength(1);
    expect(result.plan.providerConnections[0].provider).toBe("codebuddy-intl");
    expect(result.plan.providerConnections[0].isActive).toBe(false);
    expect(result.plan.providerConnections[0].accessToken).toBe("access-secret");
    expect(result.plan.providerConnections[0].testStatus).toBeUndefined();
    expect(result.plan.providerConnections[0].backoffLevel).toBeUndefined();
    expect(result.plan.providerConnections[0].modelLock_example).toBeUndefined();
    expect(result.plan.providerConnections[0].providerSpecificData.upstreamUserAgent).toBeUndefined();
    expect(result.plan.customModels[0].providerAlias).toBe("codebuddy-intl");
    expect(JSON.stringify(result.preview)).not.toContain("access-secret");
    expect(JSON.stringify(result.preview)).not.toContain("refresh-secret");
  });

  test("deduplicates credentials and remaps colliding custom-provider IDs", () => {
    const payload = source({
      providerNodes: [{
        id: "custom-provider",
        type: "openai-compatible",
        name: "Imported provider",
        prefix: "imported",
        baseUrl: "https://new.example/v1",
      }],
      providerConnections: [
        {
          id: "duplicate-account",
          provider: "openrouter",
          authType: "apikey",
          apiKey: "same-key",
        },
        {
          id: "new-account",
          provider: "custom-provider",
          authType: "apikey",
          apiKey: "new-key",
          providerSpecificData: { prefix: "imported" },
        },
      ],
      customModels: [{ providerAlias: "missing-provider", id: "orphan", type: "llm" }],
    });
    const current = {
      ...emptyCurrent,
      providerConnections: [{
        id: "existing-account",
        provider: "openrouter",
        authType: "apikey",
        apiKey: "same-key",
      }],
      providerNodes: [{
        id: "custom-provider",
        type: "openai-compatible",
        name: "Existing provider",
        prefix: "existing",
        baseUrl: "https://existing.example/v1",
      }],
    };

    const result = buildNineRouterMigrationPlan(payload, {}, current);
    expect(result.preview.sections.providerAccounts.duplicates).toBe(1);
    expect(result.plan.providerConnections).toHaveLength(1);
    expect(result.plan.providerNodes).toHaveLength(1);
    expect(result.plan.providerNodes[0].id).not.toBe("custom-provider");
    expect(result.plan.providerConnections[0].provider).toBe(result.plan.providerNodes[0].id);
    expect(result.preview.sections.customModels.skipped).toBe(1);
  });

  test("forces custom providers on for custom models and leaves routing off by default", () => {
    const payload = source({
      providerNodes: [{
        id: "custom-provider",
        type: "openai-compatible",
        name: "Custom",
        prefix: "custom",
        baseUrl: "https://example.com/v1",
      }],
      customModels: [{ providerAlias: "custom-provider", id: "model-a", type: "llm" }],
    });
    const result = buildNineRouterMigrationPlan(
      payload,
      { customModels: true, customProviders: false, routingSettings: false },
      emptyCurrent,
    );
    expect(result.options.customProviders).toBe(true);
    expect(result.plan.providerNodes).toHaveLength(1);
    expect(result.plan.customModels).toHaveLength(1);
    expect(result.plan.settings).toEqual({});
    expect(result.preview.sections.routingSettings.ready).toBe(0);
  });

  test("only imports the routing subset and preserves security settings", () => {
    const result = buildNineRouterMigrationPlan(
      source(),
      {
        providerAccounts: false,
        customProviders: false,
        customModels: false,
        combos: false,
        routingSettings: true,
      },
      emptyCurrent,
    );
    expect(result.plan.settings.requireLogin).toBeUndefined();
    expect(result.plan.settings.fallbackStrategy).toBe("fill-first");
    expect(result.plan.settings.providerStrategies["codebuddy-intl"]).toEqual({ strategy: "round-robin" });
  });

  test("rolls back every inserted section when a write fails", () => {
    const raw = new Database(":memory:");
    raw.exec("CREATE TABLE providerNodes(id TEXT PRIMARY KEY, type TEXT, name TEXT, data TEXT, createdAt TEXT, updatedAt TEXT)");
    raw.exec("CREATE TABLE providerConnections(id TEXT PRIMARY KEY, provider TEXT, authType TEXT, name TEXT, email TEXT, priority INTEGER, isActive INTEGER, data TEXT, createdAt TEXT, updatedAt TEXT)");
    raw.exec("CREATE TABLE kv(scope TEXT, key TEXT, value TEXT, PRIMARY KEY(scope, key))");
    raw.exec("CREATE TABLE combos(id TEXT PRIMARY KEY, name TEXT UNIQUE, kind TEXT, models TEXT, createdAt TEXT, updatedAt TEXT)");
    raw.exec("CREATE TABLE settings(id INTEGER PRIMARY KEY, data TEXT)");
    const db = {
      run(sql, params = []) { return raw.prepare(sql).run(...params); },
      transaction(fn) { return raw.transaction(fn)(); },
    };
    const plan = {
      providerNodes: [{ id: "node-1", type: "openai-compatible", name: "Node", prefix: "node" }],
      providerConnections: [],
      customModels: [],
      combos: [
        { id: "combo-1", name: "Same", models: [] },
        { id: "combo-2", name: "Same", models: [] },
      ],
      settings: {},
    };
    expect(() => writeNineRouterMigrationPlan(db, plan, "2026-01-01T00:00:00.000Z"))
      .toThrow();
    expect(raw.query("SELECT COUNT(*) AS count FROM providerNodes").get().count).toBe(0);
    expect(raw.query("SELECT COUNT(*) AS count FROM combos").get().count).toBe(0);
    raw.close();
  });
});
