import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { makeKv } from "../helpers/kvStore.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

const customKv = makeKv("customModels");

const customCache = getConfigCache("customModels", { ttlMs: 5000 });

function isClinePassProvider(providerAlias) {
  const value = String(providerAlias || "").trim().toLowerCase();
  return value === "clinepass" || value === "cline-pass";
}

function canonicalModelId(providerAlias, id) {
  const value = String(id || "").trim();
  if (!isClinePassProvider(providerAlias)) return value;
  return value.replace(/^(?:clinepass|cline-pass)\//i, "");
}

function canonicalProviderAlias(providerAlias) {
  return isClinePassProvider(providerAlias) ? "clinepass" : String(providerAlias || "").trim();
}

function customKey(providerAlias, id, type) {
  return `${canonicalProviderAlias(providerAlias)}|${canonicalModelId(providerAlias, id)}|${type}`;
}

function legacyCustomKeys(providerAlias, id, type) {
  const providerValue = String(providerAlias || "").trim();
  const provider = canonicalProviderAlias(providerValue);
  const value = String(id || "").trim();
  const canonical = canonicalModelId(providerValue, value);
  const keys = new Set([
    customKey(provider, canonical, type),
    `${provider}|${canonical}|${type}`,
    `${providerValue}|${value}|${type}`,
  ]);
  if (isClinePassProvider(providerValue)) {
    keys.add(`${provider}|cline-pass/${canonical}|${type}`);
    keys.add(`${provider}|clinepass/${canonical}|${type}`);
    keys.add(`cline-pass|${canonical}|${type}`);
    keys.add(`cline-pass|cline-pass/${canonical}|${type}`);
    keys.add(`cline-pass|clinepass/${canonical}|${type}`);
  }
  return [...keys];
}

export async function getCustomModels() {
  const all = await customCache.get("all", () => customKv.getAll());
  const deduped = new Map();
  for (const raw of Object.values(all)) {
    if (!raw?.id || !raw?.providerAlias) continue;
    const providerAlias = canonicalProviderAlias(raw.providerAlias);
    const id = canonicalModelId(providerAlias, raw.id);
    const type = raw.type || "llm";
    const key = `${providerAlias}|${id}|${type}`;
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, { ...raw, providerAlias, id, type });
    } else if (!existing.capabilities && raw.capabilities) {
      deduped.set(key, { ...existing, capabilities: raw.capabilities });
    }
  }
  return [...deduped.values()];
}

export async function addCustomModel({ providerAlias, id, type = "llm", name, capabilities }) {
  const provider = canonicalProviderAlias(providerAlias);
  const modelId = canonicalModelId(provider, id);
  const key = customKey(provider, modelId, type);
  const db = await getAdapter();
  let changed = false;
  db.transaction(() => {
    const existing = legacyCustomKeys(provider, id, type)
      .map((candidate) => db.get(`SELECT key, value FROM kv WHERE scope = 'customModels' AND key = ?`, [candidate]))
      .find(Boolean);
    const parsedExisting = existing ? parseJson(existing.value, {}) : {};
    const value = stringifyJson({
      ...parsedExisting,
      providerAlias: provider,
      id: modelId,
      type,
      name: name || parsedExisting.name || modelId,
      ...(capabilities && typeof capabilities === "object" ? { capabilities } : {}),
    });
    if (existing) {
      if (existing.key !== key) db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [key]);
      if (existing.key !== key || value !== existing.value) {
        db.run(`UPDATE kv SET key = ?, value = ? WHERE scope = 'customModels' AND key = ?`, [key, value, existing.key]);
        changed = true;
      }
      return;
    }
    db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [key, value]);
    changed = true;
  });
  if (changed) await bumpConfigCacheVersion().catch(() => {});
  return changed;
}

export async function deleteCustomModel({ providerAlias, id, type = "llm" }) {
  const db = await getAdapter();
  for (const key of legacyCustomKeys(providerAlias, id, type)) {
    db.run(`DELETE FROM kv WHERE scope = 'customModels' AND key = ?`, [key]);
  }
  await bumpConfigCacheVersion().catch(() => {});
}
