import { getAdapter } from "./driver.js";
import { stringifyJson, parseJson } from "./helpers/jsonCol.js";
import { bumpConfigCacheVersion } from "../cache/ttlCache.js";
import { stripRemovedSettings } from "./repos/settingsRepo.js";
import { isNineRouterBackupPayload } from "./nineRouterMigration.js";

export {
  getSettings, updateSettings, isCloudEnabled, getCloudUrl, exportSettings,
} from "./repos/settingsRepo.js";

export {
  getProviderConnections, getProviderConnectionById, getActiveProviderRows,
  getProviderConnectionsForRouting, getProviderConnectionsPaged, countProviderConnections,
  countConnectionsByProxyPool,
  createProviderConnection, updateProviderConnection,
  deleteProviderConnection, deleteProviderConnectionsByProvider,
  reorderProviderConnections, cleanupProviderConnections,
} from "./repos/connectionsRepo.js";

export {
  getProviderNodes, getProviderNodeById,
  createProviderNode, updateProviderNode, deleteProviderNode,
} from "./repos/nodesRepo.js";

export {
  getProxyPools, getProxyPoolById,
  createProxyPool, updateProxyPool, deleteProxyPool,
} from "./repos/proxyPoolsRepo.js";

export {
  getApiKeys, getApiKeyById, getActiveApiKey, getApiKeySecretById, createApiKey, updateApiKey, deleteApiKey, rotateApiKey, validateApiKey,
} from "./repos/apiKeysRepo.js";

export {
  getCombos, getComboById, getComboByName,
  createCombo, updateCombo, deleteCombo,
} from "./repos/combosRepo.js";

export {
  getCustomModels, addCustomModel, deleteCustomModel,
} from "./repos/aliasRepo.js";

export {
  getPricing, getPricingForModel, updatePricing, resetPricing, resetAllPricing,
} from "./repos/pricingRepo.js";

export {
  getDisabledModels, getDisabledByProvider, disableModels, enableModels,
} from "./repos/disabledModelsRepo.js";

export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, clearUsageHistory, getUsageHistory, getUsageHistoryPage, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs, searchLogs,
} from "./repos/usageRepo.js";

export {
  saveRequestDetail, clearRequestDetails, getRequestDetails, getRequestDetailById, getDistinctProviders,
} from "./repos/requestDetailsRepo.js";

const BACKUP_SCOPES = new Set(["configuration", "full"]);
const MAX_BACKUP_ITEMS = 20_000;
const REQUIRED_CONFIG_FIELDS = [
  "settings", "providerConnections", "providerNodes", "proxyPools",
  "apiKeys", "combos", "customModels", "pricing",
];

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidBackup(message) {
  throw new Error(`Invalid database payload: ${message}`);
}

function assertPlainObject(value, path) {
  if (!isPlainObject(value)) invalidBackup(`${path} must be an object`);
}

function assertArray(value, path) {
  if (!Array.isArray(value)) invalidBackup(`${path} must be an array`);
  if (value.length > MAX_BACKUP_ITEMS) invalidBackup(`${path} contains too many items`);
}

function assertString(value, path, { required = true, max = 4096 } = {}) {
  if (value === undefined || value === null) {
    if (required) invalidBackup(`${path} is required`);
    return;
  }
  if (typeof value !== "string" || value.length > max || (required && value.trim() === "")) {
    invalidBackup(`${path} must be a non-empty string of at most ${max} characters`);
  }
}

function assertBoolean(value, path) {
  if (value !== undefined && typeof value !== "boolean" && value !== 0 && value !== 1) {
    invalidBackup(`${path} must be a boolean`);
  }
}

function assertInteger(value, path) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
    invalidBackup(`${path} must be a non-negative integer`);
  }
}

function assertNumber(value, path) {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
    invalidBackup(`${path} must be a non-negative number`);
  }
}

function assertOneOf(value, path, allowed) {
  if (value !== undefined && !allowed.includes(value)) {
    invalidBackup(`${path} must be one of: ${allowed.join(", ")}`);
  }
}

function assertUniqueIds(items, path) {
  const ids = new Set();
  items.forEach((item, index) => {
    if (!isPlainObject(item)) invalidBackup(`${path}[${index}] must be an object`);
    assertString(item.id, `${path}[${index}].id`, { max: 512 });
    if (ids.has(item.id)) invalidBackup(`${path} contains duplicate id '${item.id}'`);
    ids.add(item.id);
  });
}

export function validateDatabaseBackup(payload) {
  assertPlainObject(payload, "root");
  if (isNineRouterBackupPayload(payload)) {
    invalidBackup("9Router backups must use Migrate from 9Router");
  }
  if (payload.product !== undefined && payload.product !== "swayrouter") {
    invalidBackup("backup was created by a different product");
  }
  if (payload.formatVersion !== undefined && payload.formatVersion !== 1) {
    invalidBackup(`unsupported backup format version: ${payload.formatVersion}`);
  }

  const scope = payload.backupScope === undefined ? "configuration" : payload.backupScope;
  if (!BACKUP_SCOPES.has(scope)) invalidBackup("backupScope must be 'configuration' or 'full'");
  if (payload.providerCredentialsIncluded !== undefined && typeof payload.providerCredentialsIncluded !== "boolean") {
    invalidBackup("providerCredentialsIncluded must be a boolean");
  }

  const apiKeysRedacted = payload.apiKeysRedacted === true;
  if (payload.apiKeys !== undefined && !Array.isArray(payload.apiKeys)) {
    invalidBackup("apiKeys must be an array");
  }
  if (Array.isArray(payload.apiKeys) && !apiKeysRedacted) {
    const missingSecret = payload.apiKeys.some((key) => !isPlainObject(key) || typeof key.key !== "string" || key.key.trim() === "");
    if (missingSecret) invalidBackup("API key material is required for database import");
  }

  const missingConfigFields = REQUIRED_CONFIG_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(payload, field));
  if (missingConfigFields.length > 0) {
    invalidBackup(`missing required fields: ${missingConfigFields.join(", ")}`);
  }

  assertPlainObject(payload.settings, "settings");
  assertArray(payload.providerConnections, "providerConnections");
  assertArray(payload.providerNodes, "providerNodes");
  assertArray(payload.proxyPools, "proxyPools");
  assertArray(payload.apiKeys, "apiKeys");
  assertArray(payload.combos, "combos");
  assertArray(payload.customModels, "customModels");
  assertPlainObject(payload.pricing, "pricing");

  const booleanSettings = [
    "cloudEnabled", "tunnelEnabled", "requireLogin", "requireApiKey",
    "tunnelDashboardAccess", "enableObservability", "payloadCaptureEnabled",
    "rtkEnabled", "cavemanEnabled", "ponytailEnabled",
  ];
  for (const field of booleanSettings) assertBoolean(payload.settings[field], `settings.${field}`);
  for (const field of [
    "stickyRoundRobinLimit", "comboStickyRoundRobinLimit", "observabilityMaxRecords",
    "observabilityBatchSize", "observabilityFlushIntervalMs", "observabilityMaxJsonSize",
  ]) assertInteger(payload.settings[field], `settings.${field}`);
  for (const field of [
    "profileName", "tunnelUrl", "tunnelProvider", "authMode", "oidcIssuerUrl",
    "oidcClientId", "oidcScopes", "oidcLoginLabel", "cavemanLevel", "ponytailLevel",
  ]) assertString(payload.settings[field], `settings.${field}`, { required: false, max: 4096 });
  assertOneOf(payload.settings.fallbackStrategy, "settings.fallbackStrategy", [
    "fill-first", "round-robin", "least-inflight", "cache-affine",
  ]);
  for (const field of ["providerStrategies", "quotaVisibility", "comboStrategies", "capacityAdapter", "cliModelMappings"]) {
    if (payload.settings[field] !== undefined) assertPlainObject(payload.settings[field], `settings.${field}`);
  }
  if (payload.settings.mediaProviders !== undefined) assertArray(payload.settings.mediaProviders, "settings.mediaProviders");
  if (payload.settings.accountPool !== undefined) {
    assertPlainObject(payload.settings.accountPool, "settings.accountPool");
    assertBoolean(payload.settings.accountPool.enabled, "settings.accountPool.enabled");
    for (const field of ["maxConcurrentPerAccount", "maxConcurrentPerProvider", "maxQueuePerProvider", "queueWaitTimeoutMs", "cacheTtlMs"]) {
      assertInteger(payload.settings.accountPool[field], `settings.accountPool.${field}`);
    }
  }

  assertUniqueIds(payload.providerConnections, "providerConnections");
  payload.providerConnections.forEach((connection, index) => {
    assertString(connection.provider, `providerConnections[${index}].provider`, { max: 256 });
    assertString(connection.authType, `providerConnections[${index}].authType`, { max: 128 });
    assertString(connection.name, `providerConnections[${index}].name`, { required: false, max: 512 });
    assertString(connection.email, `providerConnections[${index}].email`, { required: false, max: 1024 });
    for (const field of ["accessToken", "refreshToken", "idToken", "apiKey", "tokenType", "scope", "projectId", "lastError", "lastErrorAt", "testStatus"]) {
      assertString(connection[field], `providerConnections[${index}].${field}`, { required: false, max: 64 * 1024 });
    }
    assertBoolean(connection.isActive, `providerConnections[${index}].isActive`);
    assertInteger(connection.priority, `providerConnections[${index}].priority`);
    if (connection.providerSpecificData !== undefined) assertPlainObject(connection.providerSpecificData, `providerConnections[${index}].providerSpecificData`);
  });

  assertUniqueIds(payload.providerNodes, "providerNodes");
  payload.providerNodes.forEach((node, index) => {
    assertString(node.type, `providerNodes[${index}].type`, { required: false, max: 256 });
    assertString(node.name, `providerNodes[${index}].name`, { required: false, max: 512 });
  });

  assertUniqueIds(payload.proxyPools, "proxyPools");
  payload.proxyPools.forEach((pool, index) => {
    assertBoolean(pool.isActive, `proxyPools[${index}].isActive`);
    assertString(pool.testStatus, `proxyPools[${index}].testStatus`, { required: false, max: 128 });
  });

  payload.apiKeys.forEach((key, index) => {
    if (!isPlainObject(key)) invalidBackup(`apiKeys[${index}] must be an object`);
    assertString(key.id, `apiKeys[${index}].id`, { max: 512 });
    if (apiKeysRedacted) {
      assertString(key.name, `apiKeys[${index}].name`, { required: false, max: 512 });
    } else assertString(key.key, `apiKeys[${index}].key`, { max: 4096 });
    assertBoolean(key.isActive, `apiKeys[${index}].isActive`);
    assertBoolean(key.isDefault, `apiKeys[${index}].isDefault`);
  });

  assertUniqueIds(payload.combos, "combos");
  payload.combos.forEach((combo, index) => {
    assertString(combo.name, `combos[${index}].name`, { max: 512 });
    assertString(combo.kind, `combos[${index}].kind`, { required: false, max: 128 });
    if (combo.models !== undefined) assertArray(combo.models, `combos[${index}].models`);
  });

  payload.customModels.forEach((model, index) => {
    assertPlainObject(model, `customModels[${index}]`);
    assertString(model.providerAlias, `customModels[${index}].providerAlias`, { max: 256 });
    assertString(model.id, `customModels[${index}].id`, { max: 1024 });
    assertString(model.type, `customModels[${index}].type`, { required: false, max: 128 });
  });

  for (const [provider, models] of Object.entries(payload.pricing)) {
    assertString(provider, "pricing provider", { max: 256 });
    assertPlainObject(models, `pricing.${provider}`);
  }

  if (scope === "full") {
    for (const field of ["usageHistory", "usageDaily", "requestDetails"]) {
      if (!Object.prototype.hasOwnProperty.call(payload, field)) invalidBackup(`full backup is missing ${field}`);
      assertArray(payload[field], field);
    }

    const usageIds = new Set();
    payload.usageHistory.forEach((entry, index) => {
      assertPlainObject(entry, `usageHistory[${index}]`);
      if (entry.id === undefined || entry.id === null) {
        invalidBackup(`usageHistory[${index}].id is required`);
      }
      assertInteger(entry.id, `usageHistory[${index}].id`);
      if (usageIds.has(entry.id)) invalidBackup(`usageHistory contains duplicate id '${entry.id}'`);
      usageIds.add(entry.id);
      assertString(entry.timestamp, `usageHistory[${index}].timestamp`, { max: 128 });
      assertString(entry.provider, `usageHistory[${index}].provider`, { required: false, max: 256 });
      assertString(entry.model, `usageHistory[${index}].model`, { required: false, max: 1024 });
      assertString(entry.connectionId, `usageHistory[${index}].connectionId`, { required: false, max: 512 });
      assertString(entry.apiKey, `usageHistory[${index}].apiKey`, { required: false, max: 512 });
      assertString(entry.endpoint, `usageHistory[${index}].endpoint`, { required: false, max: 2048 });
      assertString(entry.status, `usageHistory[${index}].status`, { required: false, max: 128 });
      for (const field of ["promptTokens", "completionTokens"]) assertInteger(entry[field], `usageHistory[${index}].${field}`);
      assertNumber(entry.cost, `usageHistory[${index}].cost`);
      assertPlainObject(entry.tokens, `usageHistory[${index}].tokens`);
      assertPlainObject(entry.meta, `usageHistory[${index}].meta`);
    });

    const usageDates = new Set();
    payload.usageDaily.forEach((entry, index) => {
      assertPlainObject(entry, `usageDaily[${index}]`);
      assertString(entry.dateKey, `usageDaily[${index}].dateKey`, { max: 32 });
      if (usageDates.has(entry.dateKey)) invalidBackup(`usageDaily contains duplicate dateKey '${entry.dateKey}'`);
      usageDates.add(entry.dateKey);
      assertPlainObject(entry.data, `usageDaily[${index}].data`);
    });

    assertUniqueIds(payload.requestDetails, "requestDetails");
    payload.requestDetails.forEach((entry, index) => {
      assertString(entry.timestamp, `requestDetails[${index}].timestamp`, { max: 128 });
      assertString(entry.provider, `requestDetails[${index}].provider`, { required: false, max: 256 });
      assertString(entry.model, `requestDetails[${index}].model`, { required: false, max: 1024 });
      assertString(entry.connectionId, `requestDetails[${index}].connectionId`, { required: false, max: 512 });
      assertString(entry.status, `requestDetails[${index}].status`, { required: false, max: 128 });
      assertPlainObject(entry.data, `requestDetails[${index}].data`);
      assertString(entry.trace_id, `requestDetails[${index}].trace_id`, { required: false, max: 256 });
      assertString(entry.payload_capture, `requestDetails[${index}].payload_capture`, { required: false, max: 128 });
    });
  } else if (["usageHistory", "usageDaily", "requestDetails"].some((field) => Object.prototype.hasOwnProperty.call(payload, field))) {
    invalidBackup("usage data requires backupScope 'full'");
  }

  return { scope, apiKeysRedacted };
}

export async function exportDb({ scope = "configuration" } = {}) {
  if (!BACKUP_SCOPES.has(scope)) throw new Error("Backup scope must be 'configuration' or 'full'");
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");
  const rawSettings = await exportSettings();
  const { password: _password, oidcClientSecret: _oidcClientSecret, ...safeSettings } = stripRemovedSettings(rawSettings);

  const out = {
    product: "swayrouter",
    formatVersion: 1,
    backupScope: scope,
    providerCredentialsIncluded: true,

    settings: safeSettings,
    providerConnections: db.all(`SELECT * FROM providerConnections`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, provider: r.provider, authType: r.authType, name: r.name, email: r.email, priority: r.priority, isActive: r.isActive === 1, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    providerNodes: db.all(`SELECT * FROM providerNodes`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, type: r.type, name: r.name, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    proxyPools: db.all(`SELECT * FROM proxyPools`).map((r) => ({ ...parseJson(r.data, {}), id: r.id, isActive: r.isActive === 1, testStatus: r.testStatus, createdAt: r.createdAt, updatedAt: r.updatedAt })),

    apiKeysRedacted: true,
    apiKeys: db.all(`SELECT * FROM apiKeys ORDER BY isDefault DESC, createdAt ASC`).map((r) => ({ id: r.id, name: r.name, machineId: r.machineId, isActive: r.isActive === 1, isDefault: r.isDefault === 1, createdAt: r.createdAt })),
    combos: db.all(`SELECT * FROM combos`).map((r) => ({ id: r.id, name: r.name, kind: r.kind, models: parseJson(r.models, []), createdAt: r.createdAt, updatedAt: r.updatedAt })),
    customModels: [],
    pricing: {},
  };

  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'customModels'`)) out.customModels.push(parseJson(r.value));
  for (const r of db.all(`SELECT key, value FROM kv WHERE scope = 'pricing'`)) out.pricing[r.key] = parseJson(r.value);

  if (scope === "full") {
    out.usageHistory = db.all(`SELECT id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta FROM usageHistory ORDER BY id ASC`).map((row) => ({
      ...row,
      tokens: parseJson(row.tokens, {}),
      meta: parseJson(row.meta, {}),
    }));
    out.usageDaily = db.all(`SELECT dateKey, data FROM usageDaily ORDER BY dateKey ASC`).map((row) => ({
      dateKey: row.dateKey,
      data: parseJson(row.data, {}),
    }));
    out.requestDetails = db.all(`SELECT id, timestamp, provider, model, connectionId, status, data, trace_id, payload_capture FROM requestDetails ORDER BY timestamp ASC, id ASC`).map((row) => ({
      ...row,
      data: parseJson(row.data, {}),
    }));
  }

  return out;
}

export async function importDb(payload) {
  const { scope, apiKeysRedacted } = validateDatabaseBackup(payload);
  const apiKeys = Array.isArray(payload.apiKeys) ? payload.apiKeys : [];
  const hasKeyMaterial = apiKeys.length > 0 && !apiKeysRedacted;
  const db = await getAdapter();
  const { exportSettings } = await import("./repos/settingsRepo.js");
  const currentSettings = await exportSettings();
  const preserveApiKeys = apiKeysRedacted || !hasKeyMaterial;

  db.transaction(() => {

    db.run(`DELETE FROM settings`);
    db.run(`DELETE FROM providerConnections`);
    db.run(`DELETE FROM providerNodes`);
    db.run(`DELETE FROM proxyPools`);
    if (!preserveApiKeys) db.run(`DELETE FROM apiKeys`);
    db.run(`DELETE FROM combos`);
    db.run(`DELETE FROM kv WHERE scope IN ('customModels', 'pricing')`);
    if (scope === "full") {
      db.run(`DELETE FROM usageHistory`);
      db.run(`DELETE FROM usageDaily`);
      db.run(`DELETE FROM requestDetails`);
    }

    if (payload.settings) {
      const settings = stripRemovedSettings(payload.settings);

      if (currentSettings?.password) settings.password = currentSettings.password;
      else delete settings.password;
      if (currentSettings?.oidcClientSecret) {
        settings.oidcClientSecret = currentSettings.oidcClientSecret;
      } else {
        delete settings.oidcClientSecret;
      }
      delete settings.upstreamUserAgent;
      db.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      if (rest.providerSpecificData && typeof rest.providerSpecificData === "object" && !Array.isArray(rest.providerSpecificData)) {
        rest.providerSpecificData = { ...rest.providerSpecificData };
        delete rest.providerSpecificData.upstreamUserAgent;
        delete rest.providerSpecificData.userAgentProfile;
      }
      db.run(
        `INSERT OR REPLACE INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT OR REPLACE INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT OR REPLACE INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
      );
    }
    if (!preserveApiKeys) {
      for (const k of apiKeys) {
        db.run(
          `INSERT OR REPLACE INTO apiKeys(id, key, name, machineId, isActive, isDefault, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
          [k.id, k.key.trim(), k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.isDefault === true ? 1 : 0, k.createdAt || new Date().toISOString()]
        );
      }
    }
    for (const c of payload.combos || []) {
      db.run(
        `INSERT OR REPLACE INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
      );
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT OR REPLACE INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }

    if (scope === "full") {
      for (const entry of payload.usageHistory) {
        db.run(
          `INSERT OR REPLACE INTO usageHistory(id, timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.id, entry.timestamp, entry.provider || null, entry.model || null, entry.connectionId || null, entry.apiKey || null, entry.endpoint || null, entry.promptTokens || 0, entry.completionTokens || 0, entry.cost || 0, entry.status || "ok", stringifyJson(entry.tokens || {}), stringifyJson(entry.meta || {})],
        );
      }
      for (const entry of payload.usageDaily) {
        db.run(
          `INSERT OR REPLACE INTO usageDaily(dateKey, data) VALUES(?, ?)`,
          [entry.dateKey, stringifyJson(entry.data)],
        );
      }
      for (const entry of payload.requestDetails) {
        db.run(
          `INSERT OR REPLACE INTO requestDetails(id, timestamp, provider, model, connectionId, status, data, trace_id, payload_capture) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [entry.id, entry.timestamp, entry.provider || null, entry.model || null, entry.connectionId || null, entry.status || null, stringifyJson(entry.data), entry.trace_id || null, entry.payload_capture || null],
        );
      }
    }
  });

  await bumpConfigCacheVersion().catch(() => {});
  return await exportDb({ scope });
}

export async function initDb() {
  await getAdapter();

  try {
    const { reapExpired } = await import("./repos/accountModelLocksRepo.js");
    await reapExpired();
  } catch {

  }
}
