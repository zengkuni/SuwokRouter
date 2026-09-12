import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { getAdapter } from "./driver.js";
import { DATA_FILE } from "./paths.js";
import { parseJson, stringifyJson } from "./helpers/jsonCol.js";
import { makeBackupDir, backupDbLite, pruneOldBackups } from "./backup.js";
import { bumpConfigCacheVersion } from "../cache/ttlCache.js";
import REGISTRY from "../../providers/registry/index.js";

const MAX_MIGRATION_ITEMS = 100_000;
const CUSTOM_PROVIDER_TYPES = new Set([
  "openai-compatible",
  "anthropic-compatible",
  "custom-embedding",
]);
const ROUTING_SETTING_KEYS = new Set([
  "fallbackStrategy",
  "stickyRoundRobinLimit",
  "comboStickyRoundRobinLimit",
  "accountPool",
  "capacityAdapter",
  "providerStrategies",
  "providerThinking",
  "comboStrategies",
]);
const TRANSIENT_CONNECTION_FIELDS = new Set([
  "testStatus",
  "lastTested",
  "healthStatus",
  "healthError",
  "healthLatencyMs",
  "errorCode",
  "backoffLevel",
  "lastUsedAt",
  "consecutiveUseCount",
  "lastError",
  "lastErrorAt",
  "lastRefreshAt",
  "rateLimitedUntil",
  "deprioritizeUntil",
  "cooldownUntil",
]);

export const DEFAULT_NINE_ROUTER_MIGRATION_OPTIONS = Object.freeze({
  providerAccounts: true,
  customProviders: true,
  customModels: true,
  combos: true,
  routingSettings: false,
  activateAccounts: false,
});

function migrationError(message, code = "INVALID_9ROUTER_SOURCE") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredArray(value, name) {
  if (!Array.isArray(value)) throw migrationError(`${name} is missing from the 9Router backup`);
  if (value.length > MAX_MIGRATION_ITEMS) {
    throw migrationError(`${name} contains more than ${MAX_MIGRATION_ITEMS.toLocaleString("en-US")} items`);
  }
  return value;
}

function optionalObject(value, name) {
  if (value === undefined || value === null) return {};
  if (!isPlainObject(value)) throw migrationError(`${name} must be an object`);
  return value;
}

function safeString(value, max = 4096) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

function normalized(value) {
  return safeString(value).toLowerCase();
}

function normalizeUrl(value) {
  return normalized(value).replace(/\/+$/, "");
}

function safeTimestamp(value, fallback) {
  const text = safeString(value, 128);
  return text && Number.isFinite(Date.parse(text)) ? text : fallback;
}

function normalizeOptions(value) {
  const input = isPlainObject(value) ? value : {};
  const options = {};
  for (const [key, defaultValue] of Object.entries(DEFAULT_NINE_ROUTER_MIGRATION_OPTIONS)) {
    options[key] = typeof input[key] === "boolean" ? input[key] : defaultValue;
  }
  if (options.customModels) options.customProviders = true;
  return options;
}

function buildBuiltinMaps() {
  const toId = new Map();
  const toAlias = new Map();
  for (const provider of REGISTRY) {
    const aliases = [provider.id, provider.alias, provider.uiAlias, ...(provider.aliases || [])]
      .map(normalized)
      .filter(Boolean);
    for (const alias of aliases) {
      toId.set(alias, provider.id);
      toAlias.set(alias, provider.uiAlias || provider.alias || provider.id);
    }
  }
  for (const legacy of ["codebuddy-int", "codebuddy-inter"]) {
    toId.set(legacy, "codebuddy-intl");
    toAlias.set(legacy, "cbai");
  }
  return { toId, toAlias };
}

const BUILTIN = buildBuiltinMaps();

export function isNineRouterBackupPayload(payload) {
  if (!isPlainObject(payload) || payload.product === "swayrouter") return false;
  if (Object.prototype.hasOwnProperty.call(payload, "modelAliases")) return true;
  if (Object.prototype.hasOwnProperty.call(payload, "mitmAlias")) return true;
  return Array.isArray(payload.providerConnections)
    && Array.isArray(payload.providerNodes)
    && Array.isArray(payload.combos)
    && Array.isArray(payload.customModels)
    && payload.formatVersion === undefined
    && payload.backupScope === undefined
    && payload.apiKeysRedacted === undefined;
}

export function validateNineRouterPayload(payload) {
  if (!isNineRouterBackupPayload(payload)) {
    throw migrationError("This file is not a supported 9Router backup");
  }
  const providerConnections = requiredArray(payload.providerConnections, "providerConnections");
  const providerNodes = requiredArray(payload.providerNodes, "providerNodes");
  const combos = requiredArray(payload.combos, "combos");
  const customModels = requiredArray(payload.customModels, "customModels");
  const settings = optionalObject(payload.settings, "settings");

  providerConnections.forEach((item, index) => {
    if (!isPlainObject(item)) throw migrationError(`providerConnections[${index}] must be an object`);
    if (!safeString(item.id, 512) || !safeString(item.provider, 256) || !safeString(item.authType, 128)) {
      throw migrationError(`providerConnections[${index}] has an invalid identity`);
    }
  });
  providerNodes.forEach((item, index) => {
    if (!isPlainObject(item) || !safeString(item.id, 512)) {
      throw migrationError(`providerNodes[${index}] has an invalid identity`);
    }
  });
  combos.forEach((item, index) => {
    if (!isPlainObject(item) || !safeString(item.id, 512) || !safeString(item.name, 512)) {
      throw migrationError(`combos[${index}] has an invalid identity`);
    }
    if (item.models !== undefined && !Array.isArray(item.models)) {
      throw migrationError(`combos[${index}].models must be an array`);
    }
  });
  customModels.forEach((item, index) => {
    if (!isPlainObject(item) || !safeString(item.providerAlias, 256) || !safeString(item.id, 1024)) {
      throw migrationError(`customModels[${index}] has an invalid identity`);
    }
  });

  return { settings, providerConnections, providerNodes, combos, customModels };
}

function nineRouterCandidates() {
  const home = os.homedir();
  const candidates = [];
  if (process.env.NINE_ROUTER_DB_PATH) candidates.push(process.env.NINE_ROUTER_DB_PATH);
  if (process.platform === "win32" && process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, "9router", "db", "data.sqlite"));
  }
  if (process.platform === "darwin") {
    candidates.push(path.join(home, "Library", "Application Support", "9router", "db", "data.sqlite"));
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config");
  candidates.push(path.join(xdgConfig, "9router", "db", "data.sqlite"));
  candidates.push(path.join(home, ".9router", "db", "data.sqlite"));
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))]
    .filter((candidate) => candidate !== path.resolve(DATA_FILE));
}

function displaySourcePath(file) {
  const home = path.resolve(os.homedir());
  const absolute = path.resolve(file);
  if (absolute.toLowerCase().startsWith(home.toLowerCase())) {
    return `~${absolute.slice(home.length)}`;
  }
  return absolute;
}

async function openNineRouterDatabase(file) {
  if (!process.versions.bun) {
    throw migrationError("Local 9Router detection requires the Bun runtime", "LOCAL_SOURCE_UNAVAILABLE");
  }
  const { Database } = await import("bun:sqlite");
  const database = new Database(file, { readonly: true });
  const tables = new Set(
    database.query("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name),
  );
  for (const required of ["settings", "providerConnections", "providerNodes", "combos", "kv"]) {
    if (!tables.has(required)) {
      database.close();
      throw migrationError("The detected database does not match a supported 9Router installation");
    }
  }
  return database;
}

async function findNineRouterDatabase() {
  for (const candidate of nineRouterCandidates()) {
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) continue;
    try {
      const database = await openNineRouterDatabase(candidate);
      database.close();
      return candidate;
    } catch {
      // Keep looking through known 9Router data locations.
    }
  }
  return null;
}

export async function getNineRouterDetection() {
  const file = await findNineRouterDatabase();
  if (!file) return { available: false };
  const database = await openNineRouterDatabase(file);
  try {
    const count = (table) => Number(database.query(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count || 0);
    return {
      available: true,
      location: displaySourcePath(file),
      counts: {
        providerAccounts: count("providerConnections"),
        customProviders: count("providerNodes"),
        combos: count("combos"),
        customModels: Number(database.query("SELECT COUNT(*) AS count FROM kv WHERE scope = 'customModels'").get()?.count || 0),
      },
    };
  } finally {
    database.close();
  }
}

export async function readDetectedNineRouterDatabase() {
  const file = await findNineRouterDatabase();
  if (!file) throw migrationError("No supported local 9Router database was found", "LOCAL_SOURCE_UNAVAILABLE");
  const database = await openNineRouterDatabase(file);
  try {
    const settingsRow = database.query("SELECT data FROM settings WHERE id = 1").get();
    const readRows = (table) => database.query(`SELECT * FROM ${table}`).all().map((row) => {
      if (table === "providerConnections") {
        return {
          ...parseJson(row.data, {}),
          id: row.id,
          provider: row.provider,
          authType: row.authType,
          name: row.name,
          email: row.email,
          priority: row.priority,
          isActive: row.isActive === 1,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }
      if (table === "providerNodes") {
        return {
          ...parseJson(row.data, {}),
          id: row.id,
          type: row.type,
          name: row.name,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        };
      }
      return {
        id: row.id,
        name: row.name,
        kind: row.kind,
        models: parseJson(row.models, []),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });
    const customModels = database
      .query("SELECT value FROM kv WHERE scope = 'customModels'")
      .all()
      .map((row) => parseJson(row.value, null))
      .filter(isPlainObject);
    return {
      settings: parseJson(settingsRow?.data, {}),
      providerConnections: readRows("providerConnections"),
      providerNodes: readRows("providerNodes"),
      proxyPools: [],
      apiKeys: [],
      combos: readRows("combos"),
      modelAliases: {},
      customModels,
      mitmAlias: null,
      pricing: {},
    };
  } finally {
    database.close();
  }
}

function readCurrentSnapshot(db) {
  return {
    settings: parseJson(db.get("SELECT data FROM settings WHERE id = 1")?.data, {}),
    providerConnections: db.all("SELECT * FROM providerConnections").map((row) => ({
      ...parseJson(row.data, {}),
      id: row.id,
      provider: row.provider,
      authType: row.authType,
      name: row.name,
      email: row.email,
      priority: row.priority,
      isActive: row.isActive === 1,
    })),
    providerNodes: db.all("SELECT * FROM providerNodes").map((row) => ({
      ...parseJson(row.data, {}),
      id: row.id,
      type: row.type,
      name: row.name,
    })),
    combos: db.all("SELECT * FROM combos").map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      models: parseJson(row.models, []),
    })),
    customModels: db
      .all("SELECT value FROM kv WHERE scope = 'customModels'")
      .map((row) => parseJson(row.value, null))
      .filter(isPlainObject),
  };
}

function nodeIdentity(node) {
  return [normalized(node.type), normalizeUrl(node.baseUrl), normalized(node.prefix)].join("|");
}

function customModelIdentity(model) {
  return [normalized(model.providerAlias), normalized(model.id), normalized(model.type || "llm")].join("|");
}

function digest(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function connectionIdentity(connection) {
  const provider = normalized(connection.provider);
  const authType = normalized(connection.authType);
  const credential = safeString(connection.apiKey, 64 * 1024)
    || safeString(connection.refreshToken, 64 * 1024)
    || safeString(connection.accessToken, 64 * 1024)
    || safeString(connection.idToken, 64 * 1024);
  if (credential) return `${provider}|${authType}|secret:${digest(credential)}`;
  const account = safeString(connection.email, 1024)
    || safeString(connection.providerSpecificData?.accountId, 1024)
    || safeString(connection.providerSpecificData?.userId, 1024);
  return account ? `${provider}|${authType}|account:${digest(normalized(account))}` : "";
}

function stripTransientConnectionFields(connection) {
  const clean = {};
  for (const [key, value] of Object.entries(connection)) {
    if (TRANSIENT_CONNECTION_FIELDS.has(key) || key.startsWith("modelLock_")) continue;
    if (/cooldown|backoff/i.test(key)) continue;
    clean[key] = value;
  }
  if (isPlainObject(clean.providerSpecificData)) {
    clean.providerSpecificData = { ...clean.providerSpecificData };
    delete clean.providerSpecificData.upstreamUserAgent;
    delete clean.providerSpecificData.userAgentProfile;
  }
  return clean;
}

function uniqueText(preferred, used, suffix) {
  const base = safeString(preferred, 512) || suffix;
  let candidate = base;
  let number = 2;
  while (used.has(normalized(candidate))) {
    candidate = `${base} (${suffix}${number === 2 ? "" : ` ${number}`})`;
    number += 1;
  }
  used.add(normalized(candidate));
  return candidate;
}

function uniquePrefix(preferred, used) {
  const base = safeString(preferred, 128) || "provider";
  let candidate = base;
  let number = 2;
  while (used.has(normalized(candidate))) {
    candidate = `${base}-9r${number === 2 ? "" : `-${number}`}`;
    number += 1;
  }
  used.add(normalized(candidate));
  return candidate;
}

function createSection(found) {
  return { found, ready: 0, resolved: 0, duplicates: 0, skipped: 0 };
}

function createWarningCollector() {
  const warnings = new Map();
  return {
    add(code, message, count = 1) {
      const existing = warnings.get(code);
      warnings.set(code, existing
        ? { ...existing, count: existing.count + count }
        : { code, message, count });
    },
    list() {
      return [...warnings.values()];
    },
  };
}

function mapBuiltinProvider(value) {
  return BUILTIN.toId.get(normalized(value)) || null;
}

function mapBuiltinAlias(value) {
  return BUILTIN.toAlias.get(normalized(value)) || null;
}

function rewriteComboModel(model, nodeIdMap, prefixMap, unavailableNodeAliases) {
  if (typeof model !== "string" || !model.trim()) return null;
  const value = model.trim();
  const slash = value.indexOf("/");
  if (slash < 1) return value;
  const prefix = value.slice(0, slash);
  const rest = value.slice(slash + 1);
  const key = normalized(prefix);
  if (unavailableNodeAliases.has(key)) return null;
  const mapped = prefixMap.get(key) || nodeIdMap.get(key) || mapBuiltinAlias(prefix);
  return mapped ? `${mapped}/${rest}` : value;
}

function rewriteStrategyMap(value, providerMap, unavailableNodeAliases) {
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const [key, strategy] of Object.entries(value)) {
    const lookup = normalized(key);
    if (unavailableNodeAliases.has(lookup)) continue;
    output[providerMap.get(lookup) || mapBuiltinProvider(key) || key] = strategy;
  }
  return output;
}

export function buildNineRouterMigrationPlan(rawPayload, rawOptions, current = {}) {
  const payload = validateNineRouterPayload(rawPayload);
  const options = normalizeOptions(rawOptions);
  const now = new Date().toISOString();
  const existing = {
    settings: isPlainObject(current.settings) ? current.settings : {},
    providerConnections: Array.isArray(current.providerConnections) ? current.providerConnections : [],
    providerNodes: Array.isArray(current.providerNodes) ? current.providerNodes : [],
    combos: Array.isArray(current.combos) ? current.combos : [],
    customModels: Array.isArray(current.customModels) ? current.customModels : [],
  };
  const sections = {
    providerAccounts: createSection(payload.providerConnections.length),
    customProviders: createSection(payload.providerNodes.length),
    customModels: createSection(payload.customModels.length),
    combos: createSection(payload.combos.length),
    routingSettings: createSection(
      Object.keys(payload.settings).filter((key) => ROUTING_SETTING_KEYS.has(key)).length,
    ),
  };
  const warning = createWarningCollector();
  const plan = { providerConnections: [], providerNodes: [], customModels: [], combos: [], settings: {} };

  const usedNodeIds = new Set(existing.providerNodes.map((node) => safeString(node.id, 512)));
  const usedNodeNames = new Set(existing.providerNodes.map((node) => normalized(node.name)).filter(Boolean));
  const usedPrefixes = new Set(existing.providerNodes.map((node) => normalized(node.prefix)).filter(Boolean));
  const nodeByIdentity = new Map(existing.providerNodes.map((node) => [nodeIdentity(node), node]));
  const nodeIdMap = new Map();
  const prefixMap = new Map();
  const unavailableNodeAliases = new Set();
  const targetNodeById = new Map(existing.providerNodes.map((node) => [safeString(node.id, 512), node]));

  for (const sourceNode of payload.providerNodes) {
    const oldId = safeString(sourceNode.id, 512);
    const oldKey = normalized(oldId);
    const oldPrefix = normalized(sourceNode.prefix);
    const legacyCodeBuddy = oldKey === "codebuddy-int" || normalized(sourceNode.type) === "codebuddy-int";
    if (legacyCodeBuddy) {
      nodeIdMap.set(oldKey, "codebuddy-intl");
      if (oldPrefix) prefixMap.set(oldPrefix, "cbai");
      sections.customProviders.resolved += 1;
      continue;
    }
    const identity = nodeIdentity(sourceNode);
    const duplicate = nodeByIdentity.get(identity);
    if (duplicate) {
      nodeIdMap.set(oldKey, duplicate.id);
      if (oldPrefix) prefixMap.set(oldPrefix, duplicate.prefix || sourceNode.prefix);
      sections.customProviders.duplicates += 1;
      continue;
    }
    if (!options.customProviders) {
      unavailableNodeAliases.add(oldKey);
      if (oldPrefix) unavailableNodeAliases.add(oldPrefix);
      sections.customProviders.skipped += 1;
      continue;
    }
    if (!CUSTOM_PROVIDER_TYPES.has(normalized(sourceNode.type))) {
      unavailableNodeAliases.add(oldKey);
      if (oldPrefix) unavailableNodeAliases.add(oldPrefix);
      sections.customProviders.skipped += 1;
      warning.add("UNSUPPORTED_CUSTOM_PROVIDER", "Unsupported custom provider types will be skipped.");
      continue;
    }
    const id = usedNodeIds.has(oldId) ? crypto.randomUUID() : oldId;
    usedNodeIds.add(id);
    const prefix = uniquePrefix(sourceNode.prefix, usedPrefixes);
    const node = {
      id,
      type: normalized(sourceNode.type),
      name: uniqueText(sourceNode.name, usedNodeNames, "9Router"),
      prefix,
      apiType: safeString(sourceNode.apiType, 128) || undefined,
      baseUrl: safeString(sourceNode.baseUrl, 4096),
      createdAt: safeTimestamp(sourceNode.createdAt, now),
      updatedAt: now,
    };
    nodeIdMap.set(oldKey, id);
    if (oldPrefix) prefixMap.set(oldPrefix, prefix);
    targetNodeById.set(id, node);
    nodeByIdentity.set(identity, node);
    plan.providerNodes.push(node);
    sections.customProviders.ready += 1;
  }

  const providerMap = new Map(nodeIdMap);
  for (const [alias, providerId] of BUILTIN.toId.entries()) providerMap.set(alias, providerId);

  const existingIdentities = new Set(existing.providerConnections.map(connectionIdentity).filter(Boolean));
  const usedConnectionIds = new Set(existing.providerConnections.map((connection) => safeString(connection.id, 512)));
  for (const sourceConnection of payload.providerConnections) {
    if (!options.providerAccounts) {
      sections.providerAccounts.skipped += 1;
      continue;
    }
    const oldProvider = normalized(sourceConnection.provider);
    if (unavailableNodeAliases.has(oldProvider)) {
      sections.providerAccounts.skipped += 1;
      warning.add("ACCOUNT_PROVIDER_UNAVAILABLE", "Accounts tied to custom providers that were not imported will be skipped.");
      continue;
    }
    const provider = providerMap.get(oldProvider) || mapBuiltinProvider(oldProvider);
    if (!provider) {
      sections.providerAccounts.skipped += 1;
      warning.add("UNSUPPORTED_ACCOUNT_PROVIDER", "Accounts for providers unavailable in Sway Router will be skipped.");
      continue;
    }
    const clean = stripTransientConnectionFields(sourceConnection);
    clean.provider = provider;
    const targetNode = targetNodeById.get(provider);
    if (targetNode && isPlainObject(clean.providerSpecificData)) {
      clean.providerSpecificData = {
        ...clean.providerSpecificData,
        prefix: targetNode.prefix,
        apiType: targetNode.apiType,
        baseUrl: targetNode.baseUrl,
        nodeName: targetNode.name,
      };
    }
    const identity = connectionIdentity(clean);
    const sourceId = safeString(clean.id, 512);
    const sameId = existing.providerConnections.find((connection) => connection.id === sourceId);
    if ((identity && existingIdentities.has(identity))
      || (sameId && normalized(sameId.provider) === normalized(provider) && normalized(sameId.authType) === normalized(clean.authType))) {
      sections.providerAccounts.duplicates += 1;
      continue;
    }
    const id = usedConnectionIds.has(sourceId) ? crypto.randomUUID() : sourceId;
    usedConnectionIds.add(id);
    if (identity) existingIdentities.add(identity);
    plan.providerConnections.push({
      ...clean,
      id,
      provider,
      authType: safeString(clean.authType, 128),
      name: safeString(clean.name, 512) || null,
      email: safeString(clean.email, 1024) || null,
      priority: Number.isSafeInteger(clean.priority) && clean.priority >= 0 ? clean.priority : null,
      isActive: options.activateAccounts,
      createdAt: safeTimestamp(clean.createdAt, now),
      updatedAt: now,
    });
    sections.providerAccounts.ready += 1;
  }

  const modelIdentities = new Set(existing.customModels.map(customModelIdentity));
  for (const sourceModel of payload.customModels) {
    if (!options.customModels) {
      sections.customModels.skipped += 1;
      continue;
    }
    const oldProvider = normalized(sourceModel.providerAlias);
    if (unavailableNodeAliases.has(oldProvider)) {
      sections.customModels.skipped += 1;
      warning.add("ORPHAN_CUSTOM_MODEL", "Custom models linked to providers missing from this backup will be skipped.");
      continue;
    }
    const providerAlias = nodeIdMap.get(oldProvider) || mapBuiltinProvider(oldProvider);
    if (!providerAlias) {
      sections.customModels.skipped += 1;
      warning.add("ORPHAN_CUSTOM_MODEL", "Custom models linked to providers missing from this backup will be skipped.");
      continue;
    }
    const model = {
      ...sourceModel,
      providerAlias,
      id: safeString(sourceModel.id, 1024),
      type: safeString(sourceModel.type, 128) || "llm",
      name: safeString(sourceModel.name, 1024) || safeString(sourceModel.id, 1024),
    };
    const identity = customModelIdentity(model);
    if (modelIdentities.has(identity)) {
      sections.customModels.duplicates += 1;
      continue;
    }
    modelIdentities.add(identity);
    plan.customModels.push(model);
    sections.customModels.ready += 1;
  }

  const usedComboIds = new Set(existing.combos.map((combo) => safeString(combo.id, 512)));
  const usedComboNames = new Set(existing.combos.map((combo) => normalized(combo.name)).filter(Boolean));
  const comboByName = new Map(existing.combos.map((combo) => [normalized(combo.name), combo]));
  const comboNameMap = new Map();
  for (const sourceCombo of payload.combos) {
    if (!options.combos) {
      sections.combos.skipped += 1;
      continue;
    }
    const models = (sourceCombo.models || [])
      .map((model) => rewriteComboModel(model, nodeIdMap, prefixMap, unavailableNodeAliases))
      .filter(Boolean);
    if (models.length === 0 && (sourceCombo.models || []).length > 0) {
      sections.combos.skipped += 1;
      warning.add("EMPTY_COMBO", "Combos with no available models will be skipped.");
      continue;
    }
    const sourceName = safeString(sourceCombo.name, 512);
    const sameName = comboByName.get(normalized(sourceName));
    if (sameName && JSON.stringify(sameName.models || []) === JSON.stringify(models)) {
      comboNameMap.set(normalized(sourceName), sameName.name);
      sections.combos.duplicates += 1;
      continue;
    }
    const name = uniqueText(sourceName, usedComboNames, "9Router");
    const sourceId = safeString(sourceCombo.id, 512);
    const id = usedComboIds.has(sourceId) ? crypto.randomUUID() : sourceId;
    usedComboIds.add(id);
    comboNameMap.set(normalized(sourceName), name);
    plan.combos.push({
      id,
      name,
      kind: safeString(sourceCombo.kind, 128) || null,
      models,
      createdAt: safeTimestamp(sourceCombo.createdAt, now),
      updatedAt: now,
    });
    sections.combos.ready += 1;
  }

  if (options.routingSettings) {
    for (const [key, value] of Object.entries(payload.settings)) {
      if (!ROUTING_SETTING_KEYS.has(key)) continue;
      if (key === "providerStrategies" || key === "providerThinking") {
        plan.settings[key] = rewriteStrategyMap(value, providerMap, unavailableNodeAliases);
      } else if (key === "comboStrategies" && isPlainObject(value)) {
        plan.settings[key] = Object.fromEntries(
          Object.entries(value).map(([name, strategy]) => [comboNameMap.get(normalized(name)) || name, strategy]),
        );
      } else if (key === "fallbackStrategy" && value === "least-inflight") {
        plan.settings[key] = "fill-first";
      } else {
        plan.settings[key] = value;
      }
      sections.routingSettings.ready += 1;
    }
  } else {
    sections.routingSettings.skipped = sections.routingSettings.found;
  }

  return {
    options,
    plan,
    preview: {
      sections,
      warnings: warning.list(),
      totalReady: Object.values(sections).reduce((sum, section) => sum + section.ready, 0),
    },
  };
}

export async function previewNineRouterMigration(payload, options) {
  const db = await getAdapter();
  const result = buildNineRouterMigrationPlan(payload, options, readCurrentSnapshot(db));
  return { options: result.options, ...result.preview };
}

export function writeNineRouterMigrationPlan(db, plan, timestamp = new Date().toISOString(), currentSettings = {}) {
  db.transaction(() => {
    for (const node of plan.providerNodes) {
      const { id, type, name, createdAt, updatedAt, ...data } = node;
      db.run(
        "INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
        [id, type, name, stringifyJson(data), createdAt || timestamp, updatedAt || timestamp],
      );
    }
    for (const connection of plan.providerConnections) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...data } = connection;
      db.run(
        "INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [id, provider, authType, name, email, priority, isActive ? 1 : 0, stringifyJson(data), createdAt || timestamp, updatedAt || timestamp],
      );
    }
    for (const model of plan.customModels) {
      const type = model.type || "llm";
      const key = `${model.providerAlias}|${model.id}|${type}`;
      db.run("INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)", [key, stringifyJson(model)]);
    }
    for (const combo of plan.combos) {
      db.run(
        "INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)",
        [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt || timestamp, combo.updatedAt || timestamp],
      );
    }
    if (Object.keys(plan.settings).length > 0) {
      const settings = { ...currentSettings, ...plan.settings };
      db.run(
        "INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
        [stringifyJson(settings)],
      );
    }
  });
}

export async function applyNineRouterMigration(payload, options) {
  const db = await getAdapter();
  const current = readCurrentSnapshot(db);
  const result = buildNineRouterMigrationPlan(payload, options, current);
  if (result.preview.totalReady === 0) {
    throw migrationError("There is no new compatible data to migrate", "NOTHING_TO_MIGRATE");
  }

  const backupDir = makeBackupDir("before-9router-migration");
  backupDbLite(db, backupDir);
  writeNineRouterMigrationPlan(db, result.plan, new Date().toISOString(), current.settings);

  await bumpConfigCacheVersion().catch(() => {});
  pruneOldBackups();
  return {
    success: true,
    message: "9Router data migrated successfully",
    backupCreated: true,
    result: result.preview,
  };
}
