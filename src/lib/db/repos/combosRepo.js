import { v4 as uuidv4 } from "uuid";
import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";
import { getConfigCache, bumpConfigCacheVersion } from "../../cache/ttlCache.js";

const combosCache = getConfigCache("combos", { ttlMs: 5000 });

async function readAllCombos() {
  const db = await getAdapter();
  const rows = await db.all(`SELECT * FROM combos ORDER BY createdAt ASC`);
  return rows.map(rowToCombo);
}

function normalizeDisabledModels(value) {
  if (!Array.isArray(value)) return [];
  const modelSet = new Set();
  for (const v of value) {
    if (typeof v !== "string" || !v) continue;
    modelSet.add(v);
  }
  return [...modelSet];
}
function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    group: row.group ?? null,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
    disabledModels: normalizeDisabledModels(parseJson(row.disabled_models, [])),
    updatedAt: row.updatedAt,
  };
}

export async function getCombos() {
  return await combosCache.get("all", readAllCombos);
}

export async function getComboById(id) {
  const db = await getAdapter();
  const row = await db.get(`SELECT * FROM combos WHERE id = $1`, [id]);
  return rowToCombo(row);
}

export async function getComboByName(name) {
  if (!name) return null;

  const all = await getCombos();
  return all.find((c) => c.name === name) ?? null;
}

export async function createCombo(data) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const disabledModels = normalizeDisabledModels(data.disabledModels).filter((m) => (data.models || []).includes(m));
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    group: data.group ?? null,
    models: data.models || [],
    disabledModels,
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO combos(id, name, kind, "group", models, disabled_models, createdAt, updatedAt) VALUES($1, $2, $3, $4, $5, $6, $7, $8)`,
    [combo.id, combo.name, combo.kind, combo.group, stringifyJson(combo.models), stringifyJson(combo.disabledModels), combo.createdAt, combo.updatedAt]
  );
  await bumpConfigCacheVersion().catch(() => {});
  return combo;
}

export async function updateCombo(id, data) {
  const db = await getAdapter();
  let result = null;
  await db.transaction(async () => {
    const row = await db.get(`SELECT * FROM combos WHERE id = $1`, [id]);
    if (!row) return;
    const merged = { ...rowToCombo(row), ...data, updatedAt: new Date().toISOString() };
    const disabledModels = normalizeDisabledModels(merged.disabledModels).filter((m) => (merged.models || []).includes(m));
    await db.run(
      `UPDATE combos SET name = $1, kind = $2, "group" = $3, models = $4, disabled_models = $5, updatedAt = $6 WHERE id = $7`,
      [merged.name, merged.kind, merged.group, stringifyJson(merged.models || []), stringifyJson(disabledModels), merged.updatedAt, id]
    );
    result = { ...merged, disabledModels };
  });
  if (result) await bumpConfigCacheVersion().catch(() => {});
  return result;
}

export async function deleteCombo(id) {
  const db = await getAdapter();
  const res = await db.run(`DELETE FROM combos WHERE id = $1`, [id]);
  const deleted = (res?.changes ?? 0) > 0;
  if (deleted) await bumpConfigCacheVersion().catch(() => {});
  return deleted;
}
