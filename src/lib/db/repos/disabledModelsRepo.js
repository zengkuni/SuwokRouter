import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

const SCOPE = "disabledModels";

const disabledCache = getConfigCache("disabledModels", { ttlMs: 5000 });

async function readAllDisabled() {
  const db = await getAdapter();
  const rows = await db.all(`SELECT key, value FROM kv WHERE scope = $1`, [SCOPE]);
  const out = {};
  for (const r of rows) out[r.key] = parseJson(r.value, []);
  return out;
}

export async function getDisabledModels() {
  return await disabledCache.get("all", readAllDisabled);
}

export async function getDisabledByProvider(providerAlias) {
  const all = await getDisabledModels();
  return all[providerAlias] ?? [];
}

export async function disableModels(providerAlias, ids) {
  if (!providerAlias || !Array.isArray(ids)) return;
  const db = await getAdapter();
  await db.transaction(async () => {
    const row = await db.get(`SELECT value FROM kv WHERE scope = $1 AND key = $2`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const merged = [...new Set([...current, ...ids])];
    await db.run(
      `INSERT INTO kv(scope, key, value) VALUES($1, $2, $3) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, providerAlias, stringifyJson(merged)]
    );
  });
  await bumpConfigCacheVersion().catch(() => {});
}

export async function enableModels(providerAlias, ids) {
  if (!providerAlias) return;
  const db = await getAdapter();
  await db.transaction(async () => {
    if (!Array.isArray(ids) || ids.length === 0) {
      await db.run(`DELETE FROM kv WHERE scope = $1 AND key = $2`, [SCOPE, providerAlias]);
      return;
    }
    const row = await db.get(`SELECT value FROM kv WHERE scope = $1 AND key = $2`, [SCOPE, providerAlias]);
    const current = row ? (parseJson(row.value, []) || []) : [];
    const removeSet = new Set(ids);
    const next = current.filter((id) => !removeSet.has(id));
    if (next.length === 0) {
      await db.run(`DELETE FROM kv WHERE scope = $1 AND key = $2`, [SCOPE, providerAlias]);
    } else {
      await db.run(
        `INSERT INTO kv(scope, key, value) VALUES($1, $2, $3) ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
        [SCOPE, providerAlias, stringifyJson(next)]
      );
    }
  });
  await bumpConfigCacheVersion().catch(() => {});
}
