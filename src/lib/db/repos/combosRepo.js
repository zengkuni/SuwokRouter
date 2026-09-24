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

function rowToCombo(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    models: parseJson(row.models, []),
    createdAt: row.createdAt,
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
  const combo = {
    id: uuidv4(),
    name: data.name,
    kind: data.kind || null,
    models: data.models || [],
    createdAt: now,
    updatedAt: now,
  };
  await db.run(
    `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES($1, $2, $3, $4, $5, $6)`,
    [combo.id, combo.name, combo.kind, stringifyJson(combo.models), combo.createdAt, combo.updatedAt]
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
    await db.run(
      `UPDATE combos SET name = $1, kind = $2, models = $3, updatedAt = $4 WHERE id = $5`,
      [merged.name, merged.kind, stringifyJson(merged.models || []), merged.updatedAt, id]
    );
    result = merged;
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
