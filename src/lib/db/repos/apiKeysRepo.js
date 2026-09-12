import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

const apiKeysCache = getConfigCache("apiKeys", { ttlMs: 5000 });
let defaultApiKeyPromise = null;

async function readAllKeys() {
  const db = await getAdapter();
  await ensureDefaultApiKey(db);
  const rows = db.all(`SELECT * FROM apiKeys ORDER BY isDefault DESC, createdAt ASC`);
  return rows.map(rowToKey);
}

async function ensureDefaultApiKey(db) {
  const existing = db.get(`SELECT id FROM apiKeys WHERE isDefault = 1 ORDER BY createdAt ASC LIMIT 1`);
  if (existing?.id) {
    db.run(`UPDATE apiKeys SET isDefault = 0 WHERE id <> ? AND isDefault = 1`, [existing.id]);
    return existing.id;
  }
  const first = db.get(`SELECT id FROM apiKeys ORDER BY createdAt ASC LIMIT 1`);
  if (first?.id) {
    db.run(`UPDATE apiKeys SET isDefault = 0`);
    db.run(`UPDATE apiKeys SET isDefault = 1 WHERE id = ?`, [first.id]);
    return first.id;
  }

  if (!defaultApiKeyPromise) {
    defaultApiKeyPromise = (async () => {

      const currentDefault = db.get(`SELECT id FROM apiKeys WHERE isDefault = 1 ORDER BY createdAt ASC LIMIT 1`);
      if (currentDefault?.id) return currentDefault.id;
      const currentFirst = db.get(`SELECT id FROM apiKeys ORDER BY createdAt ASC LIMIT 1`);
      if (currentFirst?.id) {
        db.run(`UPDATE apiKeys SET isDefault = 0`);
        db.run(`UPDATE apiKeys SET isDefault = 1 WHERE id = ?`, [currentFirst.id]);
        return currentFirst.id;
      }

      const [{ getConsistentMachineId }, { generateApiKeyWithMachine }] = await Promise.all([
        import("@/shared/utils/machineId"),
        import("@/shared/utils/apiKey"),
      ]);
      const machineId = await getConsistentMachineId();
      const generated = generateApiKeyWithMachine(machineId);
      const id = uuidv4();
      const createdAt = new Date().toISOString();
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, isDefault, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
        [id, generated.key, "Primary", machineId, 1, 1, createdAt]
      );
      return id;
    })().finally(() => {
      defaultApiKeyPromise = null;
    });
  }

  return defaultApiKeyPromise;
}

async function readKeyMap() {

  const db = await getAdapter();
  const rows = db.all(`SELECT key, isActive FROM apiKeys`);
  const map = {};
  for (const r of rows) map[r.key] = r.isActive === 1 || r.isActive === true;
  return map;
}

function rowToKey(row, includeSecret = false) {
  if (!row) return null;
  const result = {
    id: row.id,
    name: row.name,
    machineId: row.machineId,
    prefix: maskApiKeyPrefix(row.key),
    isActive: row.isActive === 1 || row.isActive === true,
    isDefault: row.isDefault === 1 || row.isDefault === true,
    createdAt: row.createdAt,
  };
  if (includeSecret) result.key = row.key;
  return result;
}

function maskApiKeyPrefix(key) {
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) return undefined;
  const match = trimmed.match(/^[^-]+-/);
  return `${match?.[0] || trimmed.slice(0, 3)}••••`;
}

export function mergeApiKeyUpdate(row, data = {}) {
  return {
    key: row.key,
    name: data.name !== undefined ? data.name : row.name,
    machineId: data.machineId !== undefined ? data.machineId : row.machineId,
    isActive: data.isActive !== undefined ? data.isActive : row.isActive === 1 || row.isActive === true,
  };
}

async function readActiveKey() {
  const db = await getAdapter();
  await ensureDefaultApiKey(db);
  const row = db.get(`SELECT key FROM apiKeys WHERE isActive = 1 ORDER BY isDefault DESC, createdAt ASC LIMIT 1`);
  return row?.key || null;
}

export async function getActiveApiKey() {
  return await apiKeysCache.get("active", readActiveKey);
}

export async function getApiKeySecretById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT key FROM apiKeys WHERE id = ?`, [id]);
  return row?.key || null;
}

export async function getApiKeys() {
  return await apiKeysCache.get("all", readAllKeys);
}

export async function getApiKeyById(id) {
  const db = await getAdapter();
  await ensureDefaultApiKey(db);
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  return rowToKey(row);
}

export async function createApiKey(name, machineId) {
  if (!machineId) throw new Error("machineId is required");
  const db = await getAdapter();
  await ensureDefaultApiKey(db);
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const result = generateApiKeyWithMachine(machineId);
  const isDefault = !db.get(`SELECT id FROM apiKeys WHERE isDefault = 1 LIMIT 1`);
  const apiKey = {
    id: uuidv4(),
    name,
    key: result.key,
    machineId,
    isActive: true,
    isDefault,
    createdAt: new Date().toISOString(),
  };
  db.run(
    `INSERT INTO apiKeys(id, key, name, machineId, isActive, isDefault, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)`,
    [apiKey.id, apiKey.key, apiKey.name, apiKey.machineId, 1, isDefault ? 1 : 0, apiKey.createdAt]
  );
  await bumpConfigCacheVersion().catch(() => {});
  return apiKey;
}

export async function updateApiKey(id, data) {
  const db = await getAdapter();
  await ensureDefaultApiKey(db);
  let result = null;
  db.transaction(() => {
    const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
    if (!row) return;

    const merged = mergeApiKeyUpdate(row, data);
    db.run(
      `UPDATE apiKeys SET key = ?, name = ?, machineId = ?, isActive = ? WHERE id = ?`,
      [merged.key, merged.name, merged.machineId, merged.isActive ? 1 : 0, id]
    );
    result = rowToKey({ ...row, ...merged });
  });
  if (result) await bumpConfigCacheVersion().catch(() => {});
  return result;
}

export async function deleteApiKey(id) {
  const db = await getAdapter();
  await ensureDefaultApiKey(db);
  const row = db.get(`SELECT isDefault FROM apiKeys WHERE id = ?`, [id]);
  if (!row) return false;
  if (row.isDefault === 1 || row.isDefault === true) {
    const error = new Error("The default API key cannot be deleted. Revoke or rotate it instead.");
    error.code = "DEFAULT_API_KEY";
    throw error;
  }
  const res = db.run(`DELETE FROM apiKeys WHERE id = ?`, [id]);
  const deleted = (res?.changes ?? 0) > 0;
  if (deleted) await bumpConfigCacheVersion().catch(() => {});
  return deleted;
}

export async function rotateApiKey(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM apiKeys WHERE id = ?`, [id]);
  if (!row) return null;
  if (!row.machineId) throw new Error("This API key has no machine id and cannot be rotated.");
  const { generateApiKeyWithMachine } = await import("@/shared/utils/apiKey");
  const generated = generateApiKeyWithMachine(row.machineId);
  db.run(`UPDATE apiKeys SET key = ? WHERE id = ?`, [generated.key, id]);
  await bumpConfigCacheVersion().catch(() => {});
  return rowToKey({ ...row, key: generated.key }, true);
}

export async function validateApiKey(key) {
  if (!key) return false;
  const map = await apiKeysCache.get("map", readKeyMap);
  return !!map[key];
}
