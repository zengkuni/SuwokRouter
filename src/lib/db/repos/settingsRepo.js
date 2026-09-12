import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

const DEFAULT_SETTINGS = {

  profileName: "",
  profileAvatar: "",
  currency: "USD",
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  tunnelProvider: "cloudflare",
  stickyRoundRobinLimit: 1,
  fallbackStrategy: "fill-first",
  providerStrategies: {},

  accountPool: {
    enabled: true,
    maxConcurrentPerAccount: 30,
    maxQueuePerProvider: 1024,
    queueWaitTimeoutMs: 30000,
    cacheTtlMs: 5000,
  },
  quotaVisibility: {},
  comboStrategy: "fallback",
  comboStickyRoundRobinLimit: 1,
  comboStrategies: {},
  capacityAdapter: {
    vision: { enabled: true, roundRobin: false, models: [] },
    pdf: { enabled: false, roundRobin: false, models: [] },
    audioInput: { enabled: true, roundRobin: false, models: [] },
    videoInput: { enabled: false, roundRobin: false, models: [] },
  },
  requireLogin: true,
  requireApiKey: true,
  tunnelDashboardAccess: true,
  enableObservability: false,

  payloadCaptureEnabled: false,
  observabilityMaxRecords: 500,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 5,
  rtkEnabled: true,
  cavemanEnabled: false,
  cavemanLevel: "full",
  ponytailEnabled: false,
  ponytailLevel: "full",

  mediaProviders: [],

  cliModelMappings: {},
};

const REMOVED_SETTING_KEYS = [
  "outboundProxyEnabled",
  "outboundProxyUrl",
  "outboundNoProxy",
  "accentColor",
  "authMode",
  "oidcIssuerUrl",
  "oidcClientId",
  "oidcClientSecret",
  "oidcScopes",
  "oidcLoginLabel",
];

export function stripRemovedSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const clean = { ...raw };
  for (const key of REMOVED_SETTING_KEYS) delete clean[key];
  return clean;
}

async function readRaw() {
  const db = await getAdapter();
  const row = db.get(`SELECT data FROM settings WHERE id = 1`);
  return stripRemovedSettings(row ? parseJson(row.data, {}) : {});
}

function mergeWithDefaults(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...stripRemovedSettings(raw) };
  for (const [key, defVal] of Object.entries(DEFAULT_SETTINGS)) {
    if (merged[key] === undefined) {
      merged[key] = defVal;
    }
  }
  return merged;
}

const settingsCache = getConfigCache("settings", { ttlMs: 5000 });

export async function getSettings() {
  return await settingsCache.get("merged", async () => {
    const raw = await readRaw();
    return mergeWithDefaults(raw);
  });
}

export async function updateSettings(updates) {
  const db = await getAdapter();
  let next;
  db.transaction(function () {
    const row = db.get(`SELECT data FROM settings WHERE id = 1`);
    const current = stripRemovedSettings(row ? parseJson(row.data, {}) : {});
    next = stripRemovedSettings({ ...current, ...updates });
    db.run(
      `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [stringifyJson(next)],
    );
  });

  await bumpConfigCacheVersion().catch(() => {});
  return mergeWithDefaults(next);
}

export async function isCloudEnabled() {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl() {
  const settings = await getSettings();
  return (
    settings.cloudUrl ||
    process.env.CLOUD_URL ||
    process.env.NEXT_PUBLIC_CLOUD_URL ||
    ""
  );
}

export async function exportSettings() {
  return await readRaw();
}
